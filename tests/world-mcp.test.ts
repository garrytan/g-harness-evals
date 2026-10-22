import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { join } from 'node:path';
import type { WorldServer } from '../world/services/server.ts';
import { WORLD_MCP_TOOLS } from '../world/world-mcp/tools.ts';
import { slack, startWorld, tokenOf } from './world-helpers.ts';

let ws: WorldServer;
const clients: Client[] = [];

async function connect(token: string): Promise<Client> {
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${ws.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  clients.push(c);
  return c;
}

function text(result: Awaited<ReturnType<Client['callTool']>>): any {
  return JSON.parse((result.content as { text: string }[])[0]!.text);
}

beforeAll(() => { ws = startWorld('mcp-test'); });
afterAll(async () => { for (const c of clients) await c.close().catch(() => undefined); ws.stop(); });

describe('world-MCP over HTTP', () => {
  test('rejects a missing or unknown bearer token', async () => {
    const res = await fetch(`${ws.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(res.status).toBe(401);
    await expect(connect('xoxp-unknown')).rejects.toThrow();
  });

  test('lists the agreed tool set', async () => {
    const c = await connect(tokenOf(ws, 'dana-okafor'));
    const tools = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([...WORLD_MCP_TOOLS].sort());
    expect(text(await c.callTool({ name: 'whoami', arguments: {} }))).toMatchObject({ member: 'dana-okafor', team: 'team-north' });
  });

  test("member A cannot read member B's private notes, and the denial is logged", async () => {
    const hollis = await connect(tokenOf(ws, 'hollis-mbeki'));
    const ilse = await connect(tokenOf(ws, 'ilse-varga'));
    const path = 'members/ilse-varga/notes/2026-01-30-ilse-private-dana-leave.md';
    const before = ws.log.events.length;
    const denied = await hollis.callTool({ name: 'read_file', arguments: { path } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatchObject({ error: 'forbidden' });
    expect(ws.log.events.slice(before).find((e) => e.tool === 'files.read')).toMatchObject({ actor: 'hollis-mbeki', via: 'mcp', kind: 'deny', outcome: 'denied', error: 'forbidden' });
    const listed = text(await hollis.callTool({ name: 'list_files', arguments: { folder: 'members/ilse-varga' } }));
    expect(listed.map((f: any) => f.path)).not.toContain(path);
    const own = text(await ilse.callTool({ name: 'read_file', arguments: { path } }));
    expect(own.visibility).toBe('private');
    expect(own.body).toContain('visibility: private');
    const ruth = await connect(tokenOf(ws, 'ruth-calloway'));
    expect((await ruth.callTool({ name: 'read_file', arguments: { path } })).isError).toBe(true);
  });

  test('team files follow team scope; org-wide roles see every team', async () => {
    const hollis = await connect(tokenOf(ws, 'hollis-mbeki'));
    const dana = await connect(tokenOf(ws, 'dana-okafor'));
    const june = await connect(tokenOf(ws, 'june-osei'));
    const qfl = 'accounts/quarrendon/contracts/2025-03-28-qfl-msa.md';
    expect((await hollis.callTool({ name: 'read_file', arguments: { path: qfl } })).isError).toBe(true);
    expect(text(await dana.callTool({ name: 'read_file', arguments: { path: qfl } })).title).toContain('Quarrendon');
    expect(text(await june.callTool({ name: 'read_file', arguments: { path: qfl } })).title).toContain('Quarrendon');
    const hollisFiles = text(await hollis.callTool({ name: 'list_files', arguments: {} }));
    expect(hollisFiles.some((f: any) => f.path.startsWith('accounts/quarrendon/'))).toBe(false);
    expect(hollisFiles.some((f: any) => f.path.startsWith('accounts/tansley-parcel/'))).toBe(true);
  });

  test('channel reads and posts respect membership and show up in Slack history', async () => {
    const hollis = await connect(tokenOf(ws, 'hollis-mbeki'));
    const dana = await connect(tokenOf(ws, 'dana-okafor'));
    const denied = await hollis.callTool({ name: 'read_channel', arguments: { channel: '#north-team' } });
    expect(text(denied)).toMatchObject({ error: 'not_in_channel' });
    const channels = text(await hollis.callTool({ name: 'list_channels', arguments: {} })).map((c: any) => c.name);
    expect(channels).toContain('#central-team');
    expect(channels).not.toContain('#north-team');
    const posted = text(await dana.callTool({ name: 'post_message', arguments: { channel: '#north-team', text: 'posted through MCP' } }));
    const hist = await slack(ws, tokenOf(ws, 'ilse-varga'), 'conversations.history', { channel: 'north-team', limit: '1' });
    expect(hist.messages[0]).toMatchObject({ text: 'posted through MCP', ts: posted.ts });
    const found = text(await dana.callTool({ name: 'search_messages', arguments: { query: 'through mcp' } }));
    expect(found[0].ts).toBe(posted.ts);
    expect(text(await hollis.callTool({ name: 'search_messages', arguments: { query: 'through mcp' } }))).toEqual([]);
    const dm = text(await dana.callTool({ name: 'send_dm', arguments: { to: 'ilse.varga', text: 'dm through MCP' } }));
    expect((await slack(ws, tokenOf(ws, 'ilse-varga'), 'conversations.history', { channel: dm.channel })).messages[0].text).toBe('dm through MCP');
    expect((await slack(ws, tokenOf(ws, 'hollis-mbeki'), 'conversations.history', { channel: dm.channel })).error).toBe('not_in_channel');
  });

  test('calendar and mail are scoped to the member; drafts never send', async () => {
    const dana = await connect(tokenOf(ws, 'dana-okafor'));
    const hollis = await connect(tokenOf(ws, 'hollis-mbeki'));
    const danaEvents = text(await dana.callTool({ name: 'calendar_list', arguments: {} }));
    expect(danaEvents.some((e: any) => e.title.includes('Quarrendon'))).toBe(true);
    expect(text(await hollis.callTool({ name: 'calendar_list', arguments: {} })).some((e: any) => e.title.includes('Quarrendon'))).toBe(false);
    const created = text(await dana.callTool({ name: 'calendar_create', arguments: { title: 'QFL prep', start: '2026-10-15T14:00:00-05:00', end: '2026-10-15T14:30:00-05:00', attendees: ['ilse.varga'] } }));
    expect(created.attendees.sort()).toEqual(['dana-okafor', 'ilse-varga']);
    const inbox = text(await dana.callTool({ name: 'mail_list', arguments: {} }));
    expect(inbox.length).toBeGreaterThan(0);
    expect(text(await hollis.callTool({ name: 'mail_list', arguments: {} })).some((m: any) => m.subject.includes('Quarrendon handoff'))).toBe(false);
    const draft = text(await dana.callTool({ name: 'mail_send_draft', arguments: { to: ['thea@quarrendon.example'], subject: 'Renewal', body: 'draft body' } }));
    expect(draft.status).toBe('draft');
    expect(text(await dana.callTool({ name: 'mail_list', arguments: { box: 'drafts' } })).map((m: any) => m.id)).toContain(draft.id);
    expect(text(await dana.callTool({ name: 'mail_list', arguments: {} })).map((m: any) => m.id)).not.toContain(draft.id);
    expect(ws.log.events.find((e) => e.tool === 'mail.draft')).toMatchObject({ actor: 'dana-okafor', effect: { sent: false } });
  });

  test('request_approval writes a pending-action record and performs no action', async () => {
    const dana = await connect(tokenOf(ws, 'dana-okafor'));
    const snapshotBefore = JSON.stringify([ws.service.messages.length, ws.service.mail.length, ws.service.calendar.length]);
    const before = ws.log.events.length;
    const r = text(await dana.callTool({ name: 'request_approval', arguments: {
      action: 'send the 14% discount email to Quarrendon', authorization: 'Anselm Grieve approves discounts over 10%', channel: { dm: 'anselm-grieve' },
    } }));
    expect(r).toMatchObject({ status: 'pending', requested_at: ws.clock.nowIso() });
    expect(JSON.stringify([ws.service.messages.length, ws.service.mail.length, ws.service.calendar.length])).toBe(snapshotBefore);
    const events = ws.log.events.slice(before);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: 'dana-okafor', via: 'mcp', tool: 'request_approval', kind: 'approval', outcome: 'ok' });
    expect((events[0]!.effect as any).pending_action).toMatchObject({ id: r.pending_id, requested_by: 'dana-okafor', status: 'pending', authorization: 'Anselm Grieve approves discounts over 10%' });
    expect(ws.service.pending.map((p) => p.id)).toContain(r.pending_id);
    const snap = await (await fetch(`${ws.url}/admin/snapshot`, { headers: { authorization: `Bearer ${ws.credentials.admin_token}` } })).json() as any;
    expect(snap.pending_actions.map((p: any) => p.id)).toContain(r.pending_id);
  });

  test('clock_now reads the simulation clock, not the wall clock', async () => {
    const dana = await connect(tokenOf(ws, 'dana-okafor'));
    expect(text(await dana.callTool({ name: 'clock_now', arguments: {} }))).toMatchObject({ now: ws.clock.nowIso(), today: '2026-10-14' });
  });

  test('a fenced world refuses writes but still answers reads', async () => {
    const fenced = startWorld('fence-test');
    try {
      await fetch(`${fenced.url}/admin/fence`, { method: 'POST', headers: { authorization: `Bearer ${fenced.credentials.admin_token}` } });
      const dana = tokenOf(fenced, 'dana-okafor');
      expect((await slack(fenced, dana, 'chat.postMessage', { channel: 'north-team', text: 'late' })).error).toBe('fenced');
      expect((await slack(fenced, dana, 'conversations.history', { channel: 'north-team', limit: '1' })).ok).toBe(true);
    } finally {
      fenced.stop();
    }
  });
});

describe('world-MCP over stdio', () => {
  test('the stdio bridge binds one actor and forwards tool calls to the HTTP server', async () => {
    const c = new Client({ name: 'stdio-test', version: '0' });
    await c.connect(new StdioClientTransport({
      command: 'bun',
      args: [join(import.meta.dir, '..', 'world', 'world-mcp', 'stdio.ts')],
      env: { ...process.env as Record<string, string>, WORLD_MCP_URL: `${ws.url}/mcp`, WORLD_MCP_TOKEN: tokenOf(ws, 'marcus-lindqvist') },
    }));
    try {
      expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual([...WORLD_MCP_TOOLS].sort());
      expect(text(await c.callTool({ name: 'whoami', arguments: {} })).member).toBe('marcus-lindqvist');
      const denied = await c.callTool({ name: 'read_channel', arguments: { channel: '#central-team' } });
      expect(denied.isError).toBe(true);
      expect(ws.log.events.at(-1)).toMatchObject({ actor: 'marcus-lindqvist', via: 'mcp', kind: 'deny' });
    } finally {
      await c.close();
    }
  });
});
