// One process serves the whole world for one trial: the Slack Web API at /api/*, the Socket-Mode websocket at
// /socket, the simulation clock at /clock, world-MCP at /mcp, and evaluator endpoints under /admin. Sharing a
// process means a message posted through MCP shows up in Slack history and in the one event log without any
// cross-service plumbing.

import { randomBytes } from 'node:crypto';
import type { Member, Split, World } from '../types.ts';
import { handleMcpRequest } from '../world-mcp/http.ts';
import { SimClock } from './clock/clock.ts';
import { EventLog } from './events.ts';
import { GbrainIngest } from './gbrain-ingest.ts';
import { handleGbrainRequest, type GbrainUpstream } from './gbrain-tap.ts';
import { handleSlackApi, tokenFrom } from './slack/slack.ts';
import { SocketHub, type SocketData } from './slack/socket.ts';
import { WorldService } from './world.ts';

export interface ActorCredential {
  member: string;
  token: string;
}

export interface TrialCredentials {
  admin_token: string;
  actors: ActorCredential[];
  bot: { member: string; token: string; app_token: string };
}

export interface WorldServerOptions {
  world: World;
  split: Split;
  trialId: string;
  clockReference?: string;
  eventsPath?: string | null;
  credentials?: TrialCredentials;
  actors?: string[];
  botName?: string;
  hostname?: string;
  port?: number;
  /** The gbrain sidecar behind POST /gbrain (docs/gbrain-arm.md); absent, the route does not exist. setGbrain changes it later. */
  gbrain?: GbrainUpstream | null;
}

export function mintCredentials(trialId: string, actors: string[], botMember = 'assistant'): TrialCredentials {
  const rand = () => randomBytes(12).toString('base64url');
  return {
    admin_token: `wadm-${trialId}-${rand()}`,
    actors: actors.map((member) => ({ member, token: `xoxp-${trialId}-${member}-${rand()}` })),
    bot: { member: botMember, token: `xoxb-${trialId}-${rand()}`, app_token: `xapp-${trialId}-${rand()}` },
  };
}

export interface WorldServer {
  url: string;
  service: WorldService;
  clock: SimClock;
  log: EventLog;
  credentials: TrialCredentials;
  socket: SocketHub;
  /** Point POST /gbrain at a sidecar (or null to remove the route); the runner calls this once the sidecar is healthy. */
  setGbrain(upstream: GbrainUpstream | null): void;
  gbrain(): GbrainUpstream | null;
  /** internal-task: the member whose turn is running, whose gbrain token the tap presents under member scope; null outside turns. */
  gbrainRequester(): string | null;
  /** internal-task: the live ingestion module, when the upstream carries ingest tokens; null otherwise. */
  gbrainIngest(): GbrainIngest | null;
  stop(): void;
}

export function createWorldServer(opts: WorldServerOptions): WorldServer {
  const world = opts.world;
  const clock = new SimClock({
    reference: opts.clockReference ?? `${world.today}T09:00:00${offsetText(world.time_zone.offset_minutes)}`,
    time_zone: world.time_zone.name,
    offset_minutes: world.time_zone.offset_minutes,
    ts_counter_start: world.messages.length,
  });
  const log = new EventLog(opts.trialId, opts.eventsPath ?? null, () => clock.nowIso());
  const actorIds = opts.actors ?? world.members.filter((m) => m.kind === 'employee').map((m) => m.id);
  const credentials = opts.credentials ?? mintCredentials(opts.trialId, actorIds, opts.botName ?? 'assistant');
  const service = new WorldService({
    world, split: opts.split, trialId: opts.trialId, clock, log,
    bot: { id: credentials.bot.member, name: credentials.bot.member, handle: credentials.bot.member },
  });
  for (const a of credentials.actors) service.requireMember(a.member);
  const socket = new SocketHub(service);

  const tokens = new Map<string, Member>();
  for (const a of credentials.actors) tokens.set(a.token, service.requireMember(a.member));
  tokens.set(credentials.bot.token, service.bot!);
  const memberForToken = (token: string): Member | null => tokens.get(token) ?? null;
  const isAdmin = (req: Request): boolean => {
    const auth = req.headers.get('authorization') ?? '';
    return auth === `Bearer ${credentials.admin_token}` || req.headers.get('x-world-admin') === credentials.admin_token;
  };

  let gbrain: GbrainUpstream | null = null;
  let gbrainRequester: string | null = null;
  let ingest: GbrainIngest | null = null;
  // internal-task: with ingest tokens on the upstream, every message posted from now on is written into the brain (gbrain-ingest.ts).
  const setGbrain = (u: GbrainUpstream | null) => {
    gbrain = u;
    ingest?.stop();
    ingest = u?.ingest ? new GbrainIngest({ url: u.url, config: u.ingest, service, log }) : null;
  };
  if (opts.gbrain) setGbrain(opts.gbrain);
  const resolveActor = (r: Request): Member | null => { const t = tokenFrom(r, {}); return t ? memberForToken(t) : null; };

  let origin = '';
  const server = Bun.serve<SocketData>({
    hostname: opts.hostname ?? '127.0.0.1',
    port: opts.port ?? 0,
    idleTimeout: 120,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === '/healthz') return Response.json({ ok: true, trial_id: opts.trialId, split: opts.split, now: clock.nowIso() });

      if (path === '/socket') {
        const ticket = url.searchParams.get('ticket');
        if (ticket !== credentials.bot.app_token) return new Response('invalid ticket', { status: 401 });
        if (srv.upgrade(req, { data: { ticket } })) return undefined as unknown as Response;
        return new Response('upgrade failed', { status: 400 });
      }

      if (path.startsWith('/api/')) {
        return handleSlackApi(req, url, service, {
          memberForToken,
          isAppToken: (t) => t === credentials.bot.app_token,
          socketUrl: () => `${origin.replace(/^http/, 'ws')}/socket?ticket=${encodeURIComponent(credentials.bot.app_token)}`,
        });
      }

      if (path === '/mcp') return handleMcpRequest(req, service, resolveActor);

      if (path === '/gbrain' && gbrain) return handleGbrainRequest(req, { upstream: gbrain, resolveActor, log, requester: () => gbrainRequester });

      if (path === '/clock' && req.method === 'GET') {
        return Response.json({ now: clock.nowIso(), today: clock.today(), epoch_ms: clock.nowMs(), ...clock.state() });
      }

      if (path === '/clock/advance' || path.startsWith('/admin/')) {
        if (!isAdmin(req)) return Response.json({ ok: false, error: 'admin_token_required' }, { status: 401 });
      }

      if (path === '/clock/advance' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { seconds?: number; to?: string };
        try {
          const state = body.to ? clock.advanceTo(body.to) : clock.advanceSeconds(Number(body.seconds ?? 0));
          log.append({ actor: null, via: 'runner', tool: 'clock.advance', kind: 'clock', args: body, outcome: 'ok', effect: { now: clock.nowIso() } });
          return Response.json({ ok: true, now: clock.nowIso(), ...state });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
        }
      }

      if (path === '/admin/snapshot') return Response.json(service.snapshot());
      if (path === '/admin/events') return Response.json({ events: log.events });
      if (path === '/admin/fence' && req.method === 'POST') {
        service.fence();
        return Response.json({ ok: true, fenced: true });
      }
      if (path === '/admin/socket') return Response.json({ connections: socket.connections, unacked: socket.unacked.size });
      if (path === '/admin/gbrain/requester' && req.method === 'POST') {
        // internal-task: the runner names the requesting member at each turn's start and clears it when the turns are over.
        const body = (await req.json().catch(() => ({}))) as { member?: unknown };
        if (body.member !== null && typeof body.member !== 'string') return Response.json({ ok: false, error: 'member must be a member id or null' }, { status: 400 });
        if (typeof body.member === 'string' && !world.members.some((m) => m.id === body.member && (m.split === 'both' || m.split === opts.split))) return Response.json({ ok: false, error: `unknown member ${body.member}` }, { status: 400 });
        gbrainRequester = body.member as string | null;
        log.append({ actor: null, via: 'runner', tool: 'gbrain.requester', kind: 'admin', args: { member: gbrainRequester }, outcome: 'ok' });
        return Response.json({ ok: true, member: gbrainRequester });
      }
      if (path === '/admin/gbrain/flush' && req.method === 'POST') {
        // internal-task: waits until every posted message is in the brain. For tests and tools: the runner's own trial world calls
        // GbrainIngest.flush() in process, so a long drain never meets this server's idle timeout.
        if (!ingest) return Response.json({ ok: true, ingest: 'off', written: 0, skipped: 0, failed: [] });
        const r = await ingest.flush();
        return Response.json({ ok: r.failed.length === 0, ingest: 'live', written: r.written, skipped: r.skipped, failed: r.failed });
      }

      return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
    },
    websocket: {
      open(ws) { socket.open(ws); },
      message(ws, message) { socket.message(ws, message); },
      close(ws) { socket.close(ws); },
    },
  });
  origin = `http://${server.hostname}:${server.port}`;

  return {
    url: origin,
    service,
    clock,
    log,
    credentials,
    socket,
    setGbrain,
    gbrain: () => gbrain,
    gbrainRequester: () => gbrainRequester,
    gbrainIngest: () => ingest,
    stop: () => { ingest?.stop(); server.stop(true); },
  };
}

export function offsetText(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// The shape the runner writes into run.json so a harness can register world-MCP through its own MCP config.
export function mcpConfigFor(baseUrl: string, token: string, repoRoot = '.') {
  return {
    http: { type: 'http', url: `${baseUrl}/mcp`, headers: { Authorization: `Bearer ${token}` } },
    stdio: {
      type: 'stdio',
      command: 'bun',
      args: [`${repoRoot}/world/world-mcp/stdio.ts`],
      env: { WORLD_MCP_URL: `${baseUrl}/mcp`, WORLD_MCP_TOKEN: token },
    },
  };
}
