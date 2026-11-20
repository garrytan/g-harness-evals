#!/usr/bin/env bun
// The MCP-at-scale catalog (internal-task plan, "The catalog and its source"): load a catalog snapshot, pick a rung's servers
// and tools, check the snapshot, and write a synthetic snapshot in the same format for tests and the keyless listing map.
//
// Format (written by the snapshot work under tasks/mcp-at-scale/catalog/):
//   servers/<server>.json  { server, source: { repo, commit, spdx, licence_file, capture_method },
//                            initialize: { protocolVersion, capabilities, serverInfo, instructions },
//                            tools: [{ name, description, inputSchema, annotations? }] }
//   ladder.json            { rungs: { "30": { servers: [{ server, tools: [names] }] }, "75": ..., "150": ..., "300": ... },
//                            core: [{ server, tools }] }
//
//   bun scripts/mcp-at-scale/catalog-load.ts synth --out <dir>      write the synthetic snapshot (15 servers x 20 tools)
//   bun scripts/mcp-at-scale/catalog-load.ts check --catalog <dir>  print every problem; exit 1 when there is one
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CatalogTool { name: string; description: string; inputSchema: Record<string, any>; annotations?: Record<string, any> }
export interface CatalogServer {
  server: string;
  source: { repo: string; commit: string; spdx: string; licence_file: string; capture_method: string };
  initialize: { protocolVersion: string; capabilities: Record<string, any>; serverInfo: { name: string; version: string; [k: string]: unknown }; instructions?: string };
  tools: CatalogTool[];
}
export interface LadderEntry { server: string; tools: string[] }
export interface Ladder { rungs: Record<string, { servers: LadderEntry[]; size?: number }>; core: LadderEntry[]; tolerance?: number }
export interface Catalog { servers: Record<string, CatalogServer>; ladder: Ladder }
/** One server as a rung serves it: the captured server with only the rung's tools, in the captured order. */
export interface RungServer { server: string; captured: CatalogServer; tools: CatalogTool[] }

export const RUNGS = ['30', '75', '150', '300'] as const;

export function loadCatalog(dir: string): Catalog {
  const servers: Record<string, CatalogServer> = {};
  for (const f of readdirSync(join(dir, 'servers')).filter((f) => f.endsWith('.json')).sort()) {
    const s = JSON.parse(readFileSync(join(dir, 'servers', f), 'utf8')) as CatalogServer;
    servers[s.server] = s;
  }
  return { servers, ladder: normalizeLadder(JSON.parse(readFileSync(join(dir, 'ladder.json'), 'utf8'))) };
}

/** The snapshot's ladder.json lists rungs as an array of { target, size, servers: [{ server, role, tools: count }],
 *  tool_names: ['<server>__<tool>'] }; turn that into the keyed form above. The keyed form passes through unchanged. */
export function normalizeLadder(raw: any): Ladder {
  if (!Array.isArray(raw.rungs)) return raw as Ladder;
  const rungs: Ladder['rungs'] = {};
  for (const r of raw.rungs) {
    const byServer = new Map<string, string[]>(r.servers.map((e: { server: string }) => [e.server, [] as string[]]));
    for (const q of r.tool_names as string[]) {
      const server = [...byServer.keys()].filter((n) => q.startsWith(n + '__')).sort((a, b) => b.length - a.length)[0];
      if (!server) throw new Error('HE-MCP-010 rung ' + r.target + ' tool ' + q + ' names no server of the rung');
      byServer.get(server)!.push(q.slice(server.length + 2));
    }
    rungs[String(r.target)] = { servers: [...byServer].map(([server, tools]) => ({ server, tools })), size: r.size };
  }
  return { rungs, core: raw.core.map((c: LadderEntry) => ({ server: c.server, tools: c.tools })), tolerance: raw.tolerance ?? 0 };
}

export function rungServers(cat: Catalog, rung: string): RungServer[] {
  const r = cat.ladder.rungs[rung];
  if (!r) throw new Error('HE-MCP-010 the catalog has no rung ' + rung + ' (rungs: ' + Object.keys(cat.ladder.rungs).join(', ') + ')');
  return r.servers.map((e) => {
    const captured = cat.servers[e.server];
    if (!captured) throw new Error('HE-MCP-010 rung ' + rung + ' names server ' + e.server + ', which has no servers/' + e.server + '.json');
    const want = new Set(e.tools);
    return { server: e.server, captured, tools: captured.tools.filter((t) => want.has(t.name)) };
  });
}

/** The name a harness that namespaces MCP tools gives a server's tool, normalized the way Pi documents it (every character
 *  other than letters, digits and _ becomes _). Two tools of one rung must never share it. */
export const qualifiedName = (server: string, tool: string) => 'mcp__' + server.replace(/[^A-Za-z0-9_]/g, '_') + '__' + tool.replace(/[^A-Za-z0-9_]/g, '_');

/** Every problem with a catalog: unknown servers or tools in the ladder, duplicate tool names within a server, rungs that are
 *  not nested, a rung whose tool count is not its key, core tools missing from a rung, and two tools of one rung that
 *  share a qualified name. */
export function checkCatalog(cat: Catalog): string[] {
  const problems: string[] = [];
  for (const s of Object.values(cat.servers)) {
    const seen = new Set<string>();
    for (const t of s.tools) {
      if (seen.has(t.name)) problems.push('server ' + s.server + ' lists tool ' + t.name + ' twice');
      seen.add(t.name);
      if (!t.inputSchema || t.inputSchema.type !== 'object') problems.push('server ' + s.server + ' tool ' + t.name + ' has no object inputSchema');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(s.server)) problems.push('server name ' + s.server + ' has characters other than letters, digits, _ and -');
  }
  const keys = Object.keys(cat.ladder.rungs).sort((a, b) => Number(a) - Number(b));
  let prev: Set<string> | null = null;
  let prevKey = '';
  for (const k of keys) {
    const pairs = new Set<string>();
    const qualified = new Map<string, string>();
    for (const e of cat.ladder.rungs[k]!.servers) {
      const s = cat.servers[e.server];
      if (!s) { problems.push('rung ' + k + ': server ' + e.server + ' has no servers/' + e.server + '.json'); continue; }
      const names = new Set(s.tools.map((t) => t.name));
      for (const t of e.tools) {
        if (!names.has(t)) problems.push('rung ' + k + ': server ' + e.server + ' has no tool ' + t);
        const pair = e.server + '/' + t;
        if (pairs.has(pair)) problems.push('rung ' + k + ': ' + pair + ' is listed twice');
        pairs.add(pair);
        const q = qualifiedName(e.server, t);
        const other = qualified.get(q);
        if (other && other !== pair) problems.push('rung ' + k + ': ' + pair + ' and ' + other + ' share the qualified name ' + q);
        qualified.set(q, pair);
      }
    }
    const tol = cat.ladder.tolerance ?? 0;
    if (Math.abs(pairs.size - Number(k)) > tol) problems.push('rung ' + k + ' serves ' + pairs.size + ' tools, more than ' + tol + ' from ' + k);
    const size = cat.ladder.rungs[k]!.size;
    if (size !== undefined && size !== pairs.size) problems.push('rung ' + k + ' says size ' + size + ' but serves ' + pairs.size + ' tools');
    if (prev) for (const p of prev) if (!pairs.has(p)) problems.push('rung ' + k + ' drops ' + p + ', which rung ' + prevKey + ' serves (rungs must be nested)');
    for (const c of cat.ladder.core) for (const t of c.tools) if (!pairs.has(c.server + '/' + t)) problems.push('rung ' + k + ' does not serve core tool ' + c.server + '/' + t);
    prev = pairs;
    prevKey = k;
  }
  return problems;
}

export function writeCatalog(dir: string, cat: Catalog): void {
  mkdirSync(join(dir, 'servers'), { recursive: true });
  for (const s of Object.values(cat.servers)) writeFileSync(join(dir, 'servers', s.server + '.json'), JSON.stringify(s, null, 1) + '\n');
  writeFileSync(join(dir, 'ladder.json'), JSON.stringify(cat.ladder, null, 1) + '\n');
}

// ---- The synthetic snapshot -------------------------------------------------------------------------------------------
// Invented services, not real ones. Six core servers spread through the alphabet; nine distractors, three of them near-twins
// of core servers (a second tracker, a second chat app, a second database) whose tool names repeat the core server's.
// Each tool is about 1,400 characters of JSON (description and schema), a little above the probe's synthetic tools.

const DOMAINS: Record<string, { objects: [string, string][]; verbs: string[] }> = {
  tracker: { objects: [['issue', 'issues'], ['comment', 'comments'], ['label', 'labels'], ['milestone', 'milestones'], ['project', 'projects']], verbs: ['create', 'get', 'list', 'update'] },
  chat: { objects: [['message', 'messages'], ['channel', 'channels'], ['thread', 'threads'], ['reaction', 'reactions'], ['member', 'members']], verbs: ['send', 'get', 'list', 'remove'] },
  database: { objects: [['table', 'tables'], ['row', 'rows'], ['index', 'indexes'], ['view', 'views'], ['backup', 'backups']], verbs: ['create', 'describe', 'list', 'drop'] },
  calendar: { objects: [['event', 'events'], ['invite', 'invites'], ['room', 'rooms'], ['reminder', 'reminders'], ['schedule', 'schedules']], verbs: ['create', 'get', 'list', 'cancel'] },
  docs: { objects: [['page', 'pages'], ['folder', 'folders'], ['template', 'templates'], ['revision', 'revisions'], ['share', 'shares']], verbs: ['create', 'read', 'search', 'archive'] },
  billing: { objects: [['invoice', 'invoices'], ['customer', 'customers'], ['refund', 'refunds'], ['subscription', 'subscriptions'], ['coupon', 'coupons']], verbs: ['create', 'get', 'list', 'void'] },
  maps: { objects: [['place', 'places'], ['route', 'routes'], ['geocode', 'geocodes'], ['area', 'areas'], ['pin', 'pins']], verbs: ['find', 'get', 'list', 'save'] },
  storage: { objects: [['bucket', 'buckets'], ['object', 'objects'], ['policy', 'policies'], ['upload', 'uploads'], ['link', 'links']], verbs: ['create', 'head', 'list', 'delete'] },
  crm: { objects: [['contact', 'contacts'], ['deal', 'deals'], ['company', 'companies'], ['note', 'notes'], ['task', 'tasks']], verbs: ['create', 'get', 'list', 'merge'] },
  monitor: { objects: [['alert', 'alerts'], ['metric', 'metrics'], ['dashboard', 'dashboards'], ['incident', 'incidents'], ['probe', 'probes']], verbs: ['create', 'query', 'list', 'mute'] },
  email: { objects: [['draft', 'drafts'], ['mailbox', 'mailboxes'], ['filter', 'filters'], ['attachment', 'attachments'], ['contact_group', 'contact_groups']], verbs: ['create', 'get', 'list', 'trash'] },
  ci: { objects: [['pipeline', 'pipelines'], ['job', 'jobs'], ['artifact', 'artifacts'], ['runner', 'runners'], ['secret_ref', 'secret_refs']], verbs: ['trigger', 'get', 'list', 'retry'] },
};

/** Server name, display name, domain and role; core first. */
export const SYNTHETIC_SERVERS: [string, string, string, 'core' | 'twin' | 'other'][] = [
  ['ash-tracker', 'Ash Tracker', 'tracker', 'core'],
  ['fern-chat', 'Fern Chat', 'chat', 'core'],
  ['kiln-db', 'Kiln DB', 'database', 'core'],
  ['osprey-calendar', 'Osprey Calendar', 'calendar', 'core'],
  ['quill-docs', 'Quill Docs', 'docs', 'core'],
  ['vale-billing', 'Vale Billing', 'billing', 'core'],
  ['birch-tracker', 'Birch Tracker', 'tracker', 'twin'],
  ['gull-chat', 'Gull Chat', 'chat', 'twin'],
  ['lark-db', 'Lark DB', 'database', 'twin'],
  ['maple-maps', 'Maple Maps', 'maps', 'other'],
  ['nimbus-storage', 'Nimbus Storage', 'storage', 'other'],
  ['pebble-crm', 'Pebble CRM', 'crm', 'other'],
  ['reef-monitor', 'Reef Monitor', 'monitor', 'other'],
  ['sable-email', 'Sable Email', 'email', 'other'],
  ['tundra-ci', 'Tundra CI', 'ci', 'other'],
];

const PLURAL_VERBS = ['list', 'search', 'query'];
const READ_VERBS = ['get', 'list', 'search', 'read', 'describe', 'query', 'head', 'find'];
const CREATE_VERBS = ['create', 'send', 'save', 'trigger'];

function syntheticTool(display: string, server: string, verb: string, obj: [string, string]): CatalogTool {
  const [one, many] = obj;
  const plural = PLURAL_VERBS.includes(verb);
  const subject = (plural ? many : one).replace(/_/g, ' ');
  const description = verb[0]!.toUpperCase() + verb.slice(1) + ' ' + (plural ? '' : 'one ') + subject + ' in ' + display + ' (' + server + '). '
    + 'Use this when the user wants to ' + verb + ' ' + (plural ? 'several ' : 'a single ') + subject + ' that already lives in ' + display + ', not in another workspace tool. '
    + 'The call is scoped to the workspace named in the request and returns structured JSON with stable identifiers, timestamps and the fields a follow-up call needs. '
    + 'Results are paginated with a cursor when there are more than fifty entries. Permissions follow the connected account; a missing permission returns an error naming the scope. '
    + 'Prefer the narrowest filter that answers the request, because broad calls are slow and rate limited.';
  const key = plural ? 'query' : one + '_id';
  const properties: Record<string, any> = {
    workspace: { type: 'string', description: 'The ' + display + ' workspace slug, for example acme or north-team. Required for every call.' },
  };
  const required = ['workspace'];
  if (CREATE_VERBS.includes(verb)) {
    properties.title = { type: 'string', description: 'A short title for the new ' + subject + '.' };
    properties.body = { type: 'string', description: 'The text of the new ' + subject + '; plain text or Markdown.' };
    required.push('title');
  } else {
    properties[key] = { type: 'string', description: plural ? 'Free-text filter over ' + subject + ' names and bodies.' : 'The identifier of the ' + subject + ', as returned by a list call.' };
    required.push(key);
  }
  properties.limit = { type: 'integer', minimum: 1, maximum: 100, description: 'How many entries to return at most. Defaults to 20.' };
  properties.fields = { type: 'array', items: { type: 'string' }, description: 'Optional list of fields to include in each result; leave empty for the default set.' };
  return { name: verb + '_' + (plural ? many : one), description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: READ_VERBS.includes(verb) } };
}

/** The synthetic snapshot: 15 servers x 20 tools; rungs 30 (six core servers x 5 tools), 75 (plus three distractors x 15),
 *  150 (plus six distractors x 20) and 300 (every server, every tool). Nested, and every rung serves every core tool. */
export function syntheticCatalog(): Catalog {
  const servers: Record<string, CatalogServer> = {};
  for (const [server, display, domain] of SYNTHETIC_SERVERS) {
    const d = DOMAINS[domain]!;
    servers[server] = {
      server,
      source: { repo: 'synthetic', commit: 'synthetic', spdx: 'MIT', licence_file: 'LICENSE', capture_method: 'synthetic (scripts/mcp-at-scale/catalog-load.ts syntheticCatalog), not captured from a real server' },
      initialize: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server + '-mcp', version: '1.0.0' },
        instructions: display + ' tools for one workspace. Name the workspace on every call.',
      },
      tools: d.objects.flatMap((o) => d.verbs.map((v) => syntheticTool(display, server, v, o))),
    };
  }
  const all = (s: string) => servers[s]!.tools.map((t) => t.name);
  const core = SYNTHETIC_SERVERS.filter((s) => s[3] === 'core').map(([server], k) => ({ server, tools: all(server).filter((_, i) => i % 4 === (Math.floor(i / 4) + k) % 4) }));
  const distractors = SYNTHETIC_SERVERS.filter((s) => s[3] !== 'core').map(([server]) => server);
  const rungs: Ladder['rungs'] = {
    '30': { servers: core.map((c) => ({ server: c.server, tools: [...c.tools] })) },
    '75': { servers: [...core.map((c) => ({ server: c.server, tools: [...c.tools] })), ...distractors.slice(0, 3).map((s) => ({ server: s, tools: all(s).slice(0, 15) }))] },
    '150': { servers: [...core.map((c) => ({ server: c.server, tools: [...c.tools] })), ...distractors.slice(0, 6).map((s) => ({ server: s, tools: all(s) }))] },
    '300': { servers: [...core.map((c) => ({ server: c.server, tools: [...c.tools, ...all(c.server).filter((t) => !c.tools.includes(t))] })), ...distractors.map((s) => ({ server: s, tools: all(s) }))] },
  };
  return { servers, ladder: { rungs, core } };
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n: string) => (rest.includes(n) ? rest[rest.indexOf(n) + 1] : undefined);
  if (cmd === 'synth') {
    const out = flag('--out');
    if (!out) { console.error('usage: catalog-load.ts synth --out <dir>'); process.exit(2); }
    writeCatalog(out, syntheticCatalog());
    console.log('wrote the synthetic catalog to ' + out);
  } else if (cmd === 'check') {
    const dir = flag('--catalog');
    if (!dir) { console.error('usage: catalog-load.ts check --catalog <dir>'); process.exit(2); }
    const problems = checkCatalog(loadCatalog(dir));
    for (const p of problems) console.log(p);
    console.log(problems.length ? problems.length + ' problem(s)' : 'catalog ok');
    process.exit(problems.length ? 1 : 0);
  } else {
    console.error('usage: catalog-load.ts synth --out <dir> | check --catalog <dir>');
    process.exit(2);
  }
}
