// A Slack Web API lookalike over the WorldService. Methods live at /api/<method>, take form, JSON or query
// parameters, and answer {ok, ...} the way api.slack.com does. Reads are limited to channels the token's
// member belongs to. Message events reach a connected harness over a Socket-Mode-style websocket (see
// socket.ts); the harness obtains the URL from apps.connections.open with its app-level token.

import type { Channel, Member, Message } from '../../types.ts';
import { WorldError, type WorldService } from '../world.ts';

export interface SlackAuth {
  // Returns the member for a user (xoxp) or bot (xoxb) token, or null.
  memberForToken(token: string): Member | null;
  isAppToken(token: string): boolean;
  socketUrl(): string;
}

const TEAM = { id: 'T0PEMBERLINE', name: 'Pemberline Systems', domain: 'pemberline' };
export const APP_ID = 'A0WORLDMCP';

function err(code: string, status = 200): Response {
  return Response.json({ ok: false, error: code }, { status });
}

export function userView(service: WorldService, m: Member) {
  const isBot = service.bot?.id === m.id;
  return {
    id: m.slack_id,
    team_id: TEAM.id,
    name: m.handle,
    real_name: m.name,
    deleted: false,
    is_admin: m.is_admin,
    is_bot: isBot,
    is_app_user: isBot,
    is_restricted: m.kind === 'contact' || m.kind === 'vendor' || m.kind === 'guest',
    tz: service.clock.timeZone,
    tz_offset: service.clock.offsetMinutes * 60,
    profile: { email: m.email, title: m.role, real_name: m.name, display_name: m.handle, team: TEAM.id },
    world: { member_id: m.id, kind: m.kind, team: m.team, org_wide: m.org_wide },
  };
}

export function channelView(service: WorldService, c: Channel, viewer: Member) {
  const base = {
    id: c.id,
    created: Math.floor(service.clock.referenceMs / 1000),
    is_archived: false,
    is_member: c.members.includes(viewer.id),
    num_members: c.members.length,
  };
  if (c.kind === 'dm') {
    const other = c.members.find((id) => id !== viewer.id) ?? c.members[0]!;
    return { ...base, is_im: true, is_channel: false, is_private: true, user: service.member(other)?.slack_id ?? other, is_mpim: c.members.length > 2 };
  }
  return {
    ...base,
    name: c.name,
    name_normalized: c.name,
    is_channel: true,
    is_im: false,
    is_private: true,
    is_general: c.kind === 'general',
    purpose: { value: c.purpose, creator: '', last_set: 0 },
    topic: { value: '', creator: '', last_set: 0 },
  };
}

export function messageView(service: WorldService, m: Message) {
  const author = service.member(m.author);
  const isBot = service.bot?.id === m.author;
  const threadTs = (m as Message & { thread_ts?: string }).thread_ts;
  return {
    type: 'message',
    user: author?.slack_id ?? m.author,
    text: m.text,
    ts: m.ts,
    team: TEAM.id,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    ...(isBot ? { bot_id: 'B0WORLDBOT', bot_profile: { id: 'B0WORLDBOT', name: author?.handle, app_id: APP_ID } } : {}),
    ...(author ? { user_profile: { real_name: author.name, display_name: author.handle } } : {}),
  };
}

async function params(req: Request, url: URL): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { out[k] = v; });
  if (req.method !== 'POST') return out;
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  } else {
    const text = await req.text();
    new URLSearchParams(text).forEach((v, k) => { out[k] = v; });
  }
  return out;
}

export function tokenFrom(req: Request, p: Record<string, string>): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return p.token ?? null;
}

export async function handleSlackApi(req: Request, url: URL, service: WorldService, auth: SlackAuth): Promise<Response> {
  const method = url.pathname.replace(/^\/api\//, '');
  const p = await params(req, url);
  const token = tokenFrom(req, p);
  if (!token) return err('not_authed');

  if (method === 'apps.connections.open') {
    if (!auth.isAppToken(token)) return err('invalid_auth');
    return Response.json({ ok: true, url: auth.socketUrl() });
  }

  const actor = auth.memberForToken(token);
  if (!actor) return err('invalid_auth');

  try {
    switch (method) {
      case 'auth.test':
        return Response.json({
          ok: true, url: `${url.origin}/`, team: TEAM.name, team_id: TEAM.id, user: actor.handle, user_id: actor.slack_id,
          ...(service.bot?.id === actor.id ? { bot_id: 'B0WORLDBOT', is_enterprise_install: false } : {}),
        });
      case 'users.list':
        return Response.json({ ok: true, members: service.members.map((m) => userView(service, m)), response_metadata: { next_cursor: '' } });
      case 'users.info': {
        const m = p.user ? service.member(p.user) : undefined;
        if (!m) return err('user_not_found');
        return Response.json({ ok: true, user: userView(service, m) });
      }
      case 'users.lookupByEmail': {
        const m = p.email ? service.member(p.email) : undefined;
        if (!m) return err('users_not_found');
        return Response.json({ ok: true, user: userView(service, m) });
      }
      case 'conversations.list': {
        const types = (p.types ?? 'public_channel').split(',');
        const wantIm = types.includes('im') || types.includes('mpim');
        const wantChannel = types.includes('public_channel') || types.includes('private_channel');
        const channels = service.channelsFor(actor, 'slack').filter((c) => (c.kind === 'dm' ? wantIm : wantChannel));
        return Response.json({ ok: true, channels: channels.map((c) => channelView(service, c, actor)), response_metadata: { next_cursor: '' } });
      }
      case 'users.conversations': {
        const channels = service.channelsFor(actor, 'slack');
        return Response.json({ ok: true, channels: channels.map((c) => channelView(service, c, actor)), response_metadata: { next_cursor: '' } });
      }
      case 'conversations.info': {
        if (!p.channel) return err('channel_not_found');
        const c = service.channel(p.channel);
        if (!c || !service.isMember(actor, c)) return err('channel_not_found');
        return Response.json({ ok: true, channel: channelView(service, c, actor) });
      }
      case 'conversations.members': {
        if (!p.channel) return err('channel_not_found');
        const c = service.channel(p.channel);
        if (!c) return err('channel_not_found');
        if (!service.isMember(actor, c)) return err('not_in_channel');
        return Response.json({ ok: true, members: c.members.map((id) => service.member(id)?.slack_id ?? id), response_metadata: { next_cursor: '' } });
      }
      case 'conversations.history': {
        if (!p.channel) return err('channel_not_found');
        const limit = Math.min(Number(p.limit ?? 100) || 100, 1000);
        const all = service.history(actor, 'slack', p.channel, { ...(p.oldest ? { oldest: p.oldest } : {}), ...(p.latest ? { latest: p.latest } : {}) })
          .filter((m) => !(m as Message & { thread_ts?: string }).thread_ts || (m as Message & { thread_ts?: string }).thread_ts === m.ts);
        const newestFirst = all.slice().reverse();
        const offset = p.cursor ? Number(Buffer.from(p.cursor, 'base64').toString('utf8').replace('offset:', '')) || 0 : 0;
        const page = newestFirst.slice(offset, offset + limit);
        const hasMore = offset + limit < newestFirst.length;
        return Response.json({
          ok: true, messages: page.map((m) => messageView(service, m)), has_more: hasMore,
          response_metadata: { next_cursor: hasMore ? Buffer.from(`offset:${offset + limit}`).toString('base64') : '' },
        });
      }
      case 'conversations.replies': {
        if (!p.channel || !p.ts) return err('thread_not_found');
        const thread = service.history(actor, 'slack', p.channel, { thread_ts: p.ts });
        if (!thread.length) return err('thread_not_found');
        return Response.json({ ok: true, messages: thread.map((m) => messageView(service, m)), has_more: false, response_metadata: { next_cursor: '' } });
      }
      case 'conversations.open': {
        const users = (p.users ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (p.channel) {
          const c = service.channel(p.channel);
          if (!c || !service.isMember(actor, c)) return err('channel_not_found');
          return Response.json({ ok: true, channel: channelView(service, c, actor) });
        }
        if (!users.length) return err('user_not_found');
        const c = service.openDm(actor, 'slack', users);
        return Response.json({ ok: true, channel: channelView(service, c, actor) });
      }
      case 'chat.postMessage': {
        if (!p.channel) return err('channel_not_found');
        if (!p.text) return err('no_text');
        const m = service.post(actor, 'slack', p.channel, p.text, p.thread_ts);
        return Response.json({ ok: true, channel: m.channel, ts: m.ts, message: messageView(service, m) });
      }
      case 'search.messages': {
        if (!p.query) return err('query_required');
        const matches = service.search(actor, 'slack', p.query, Math.min(Number(p.count ?? 20) || 20, 100));
        return Response.json({ ok: true, query: p.query, messages: { total: matches.length, matches: matches.map((m) => ({ ...messageView(service, m), channel: { id: m.channel, name: service.channel(m.channel)?.name ?? '' } })) } });
      }
      case 'team.info':
        return Response.json({ ok: true, team: { ...TEAM } });
      default:
        return err('unknown_method');
    }
  } catch (e) {
    if (e instanceof WorldError) return err(e.code);
    throw e;
  }
}
