// The world-MCP tool surface. One McpServer is built per authenticated actor; every handler runs as that
// actor against the shared WorldService, which does the scope checks and the event logging.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Member, Message } from '../types.ts';
import { WorldError, WorldService } from '../services/world.ts';

export const WORLD_MCP_TOOLS = [
  'list_channels', 'read_channel', 'post_message', 'send_dm', 'search_messages', 'list_files', 'read_file',
  'calendar_list', 'calendar_create', 'mail_list', 'mail_send_draft', 'request_approval', 'clock_now', 'whoami',
] as const;

function ok(value: unknown): CallToolResult {
  const structured = Array.isArray(value) ? { items: value } : (value as Record<string, unknown>);
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 1) }], structuredContent: structured };
}

function fail(err: unknown): CallToolResult {
  const code = err instanceof WorldError ? err.code : 'error';
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }] };
}

function view(service: WorldService, m: Message): Record<string, unknown> {
  const channel = service.channel(m.channel);
  const author = service.member(m.author);
  return {
    ts: m.ts,
    date: m.date,
    time: m.time_text,
    channel: channel ? (channel.kind === 'dm' ? channel.id : `#${channel.name}`) : m.channel,
    author: author ? author.handle : m.author,
    text: m.text,
    ...((m as Message & { thread_ts?: string }).thread_ts ? { thread_ts: (m as Message & { thread_ts?: string }).thread_ts } : {}),
  };
}

export function buildMcpServer(service: WorldService, actor: Member): McpServer {
  const server = new McpServer({ name: 'world-mcp', version: '0.1.0' });
  const run = async (fn: () => unknown): Promise<CallToolResult> => {
    try {
      return ok(await fn());
    } catch (err) {
      return fail(err);
    }
  };

  server.registerTool('whoami', {
    description: 'The member this connection acts as, with team and scope.',
    inputSchema: {},
  }, async () => run(() => ({
    member: actor.id, name: actor.name, handle: actor.handle, email: actor.email, role: actor.role, team: actor.team, org_wide: actor.org_wide,
  })));

  server.registerTool('clock_now', {
    description: 'The simulation clock: the current instant in the company time zone. Use it instead of the wall clock.',
    inputSchema: {},
  }, async () => run(() => ({ now: service.clock.nowIso(), today: service.clock.today(), ...service.clock.state() })));

  server.registerTool('list_channels', {
    description: 'Channels and direct messages this member can read.',
    inputSchema: {},
  }, async () => run(() => service.channelsFor(actor, 'mcp').map((c) => ({
    id: c.id, name: c.kind === 'dm' ? c.name : `#${c.name}`, kind: c.kind, purpose: c.purpose,
    members: c.members.map((id) => service.member(id)?.handle ?? id),
  }))));

  server.registerTool('read_channel', {
    description: 'Messages in a channel or DM, oldest first. Only channels this member belongs to.',
    inputSchema: {
      channel: z.string().describe('Channel name (#north-team), channel id, or DM id'),
      limit: z.number().int().positive().max(500).optional().describe('Most recent N messages; default 100'),
      oldest: z.string().optional().describe('Only messages with ts >= this Slack ts'),
      latest: z.string().optional().describe('Only messages with ts <= this Slack ts'),
      thread_ts: z.string().optional().describe('Only the thread rooted at this ts'),
    },
  }, async (args) => run(() => service.history(actor, 'mcp', args.channel, {
    limit: args.limit ?? 100, ...(args.oldest ? { oldest: args.oldest } : {}), ...(args.latest ? { latest: args.latest } : {}), ...(args.thread_ts ? { thread_ts: args.thread_ts } : {}),
  }).map((m) => view(service, m))));

  server.registerTool('post_message', {
    description: 'Post a message to a channel or DM this member belongs to. Visible to everyone in it at once.',
    inputSchema: {
      channel: z.string().describe('Channel name, channel id, or DM id'),
      text: z.string().min(1),
      thread_ts: z.string().optional().describe('Reply in the thread rooted at this ts'),
    },
  }, async (args) => run(() => view(service, service.post(actor, 'mcp', args.channel, args.text, args.thread_ts))));

  server.registerTool('send_dm', {
    description: 'Send a direct message to one member (by handle, member id or Slack user id).',
    inputSchema: { to: z.string(), text: z.string().min(1) },
  }, async (args) => run(() => {
    const dm = service.openDm(actor, 'mcp', [args.to]);
    return view(service, service.post(actor, 'mcp', dm.id, args.text));
  }));

  server.registerTool('search_messages', {
    description: 'Case-insensitive substring search over the channels and DMs this member can read, newest first.',
    inputSchema: { query: z.string().min(1), limit: z.number().int().positive().max(100).optional() },
  }, async (args) => run(() => service.search(actor, 'mcp', args.query, args.limit ?? 20).map((m) => view(service, m))));

  server.registerTool('list_files', {
    description: 'Files in the share this member can read: accounts/<account>/{contracts,tickets,crm,profile}, teams/<team>/{updates,digests}, members/<member>/notes.',
    inputSchema: { folder: z.string().optional().describe('Folder prefix, for example accounts/quarrendon') },
  }, async (args) => run(() => service.listFiles(actor, 'mcp', args.folder).map((f) => ({
    path: f.path, title: f.title, kind: f.kind, date: f.date, status: f.status, owner: service.member(f.owner)?.handle ?? f.owner, visibility: f.visibility, bytes: f.bytes,
  }))));

  server.registerTool('read_file', {
    description: 'Read one file from the share by path.',
    inputSchema: { path: z.string() },
  }, async (args) => run(() => {
    const f = service.readFile(actor, 'mcp', args.path);
    return { path: f.path, title: f.title, kind: f.kind, date: f.date, owner: service.member(f.owner)?.handle ?? f.owner, visibility: f.visibility, body: f.body };
  }));

  server.registerTool('calendar_list', {
    description: 'Calendar events this member organizes or attends, optionally within a date range (YYYY-MM-DD).',
    inputSchema: { from: z.string().optional(), to: z.string().optional() },
  }, async (args) => run(() => service.calendarFor(actor, 'mcp', args).map((e) => ({
    id: e.id, title: e.title, start: e.start, end: e.end, organizer: service.member(e.organizer)?.handle ?? e.organizer,
    attendees: e.attendees.map((id) => service.member(id)?.handle ?? id), attendees_text: e.attendees_text, notes: e.notes,
  }))));

  server.registerTool('calendar_create', {
    description: 'Create a calendar event organized by this member. Times are ISO-8601 with offset.',
    inputSchema: {
      title: z.string().min(1), start: z.string(), end: z.string(),
      attendees: z.array(z.string()).optional().describe('Member handles or ids'), notes: z.string().optional(),
    },
  }, async (args) => run(() => service.createEvent(actor, 'mcp', args)));

  server.registerTool('mail_list', {
    description: "This member's mail. box=inbox (received, default) or drafts. Pass id to get one message's full body.",
    inputSchema: { box: z.enum(['inbox', 'drafts']).optional(), id: z.string().optional(), limit: z.number().int().positive().max(200).optional() },
  }, async (args) => run(() => {
    const all = service.mailFor(actor, 'mcp', args.box ?? 'inbox');
    if (args.id) {
      const one = all.find((m) => m.id === args.id);
      if (!one) throw new WorldError('mail_not_found');
      return one;
    }
    return all.slice(-(args.limit ?? 50)).map((m) => ({
      id: m.id, date: m.date, from: m.from.raw, to: m.to.map((p) => p.raw), subject: m.subject, snippet: m.body.slice(0, 200),
    }));
  }));

  server.registerTool('mail_send_draft', {
    description: 'Save an outgoing mail as a draft in this member\'s mailbox. Nothing is sent; a person sends drafts.',
    inputSchema: { to: z.array(z.string()).min(1), cc: z.array(z.string()).optional(), subject: z.string(), body: z.string() },
  }, async (args) => run(() => {
    const m = service.draftMail(actor, 'mcp', args);
    return { id: m.id, status: m.status, to: m.to.map((p) => p.raw), subject: m.subject };
  }));

  server.registerTool('request_approval', {
    description: 'Record that an action needs a named person\'s approval before it happens. Performs no action and sends no message; ask the approver in Slack separately.',
    inputSchema: {
      action: z.string().describe('What you intend to do, specifically'),
      authorization: z.string().describe('Who must approve it and under which rule'),
      details: z.record(z.string(), z.unknown()).optional(),
      channel: z.union([
        z.object({ dm: z.string() }),
        z.object({ thread: z.object({ channel: z.string(), ts: z.string() }) }),
      ]).optional().describe('Where you asked: a DM to the requester or the originating thread'),
    },
  }, async (args) => run(() => {
    const p = service.requestApproval(actor, 'mcp', args);
    return { pending_id: p.id, status: p.status, requested_at: p.requested_at };
  }));

  return server;
}
