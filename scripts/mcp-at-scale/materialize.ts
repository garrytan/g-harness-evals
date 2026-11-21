#!/usr/bin/env bun
// Turns MCP-at-scale requests into Harbor 0.24.0 tasks (internal-task plan, "Arms" and "Outcomes"): one task per request and
// rung. Each task's environment is a docker compose project: the agent's container ("main") and the catalog host as a
// sidecar service ("catalog") on the task network, serving the rung's servers at http://catalog:8080/mcp/<server>, with the
// request's fixtures. task.toml lists every rung server under [environment] mcp_servers, so Harbor hands them to the agent
// class. The verifier (grade.py) reads the host's call log and writes outcomes.json; INFRA (HE-MCP-001) when any rung
// server did not get both initialize and tools/list from the harness.
//
//   bun scripts/mcp-at-scale/materialize.ts --catalog <dir> --requests <requests.json> --rungs 30,75,150,300 --out <run dir>
//       [--ids <id,id>] [--build]
//
// requests.json { "requests": [ { "id": "r-001", "text": "<the request>", "kind": "tool" | "none",
//                 "acceptable": [ { "server": "...", "tool": "...", "required": { "<arg>": <matcher> } } ],
//                 "fixtures"?: [ <catalog-host fixture rule> ] } ] }
//
// Writes <out>/catalog-image/ (the sidecar image's build context: the bundled host, the catalog, a Dockerfile on a pinned
// bun image), <out>/catalog-image.json (its tag, he-mcp-catalog:<first 16 hex of the context's sha256>), one folder per
// task under <out>/tasks/<request>__r<rung>/ and <out>/tasks.json. --build runs docker build for the image (a task's
// compose file names the tag with pull_policy never, so the image must exist on the machine that runs Harbor).
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkCatalog, loadCatalog, rungServers, type Catalog } from './catalog-load.ts';
import type { FixtureRule } from './catalog-host.ts';
import { GBRAIN_EVIDENCE, relayCommand, relaySidecar } from './gbrain.ts';

export const BUN_IMAGE = 'oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4';
export const MAIN_IMAGE = 'python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54';
export const HOST_PORT = 8080;
const HERE = import.meta.dir;

export interface Acceptable { server: string; tool: string; required?: Record<string, unknown> }
export interface McpRequest { id: string; text: string; kind: 'tool' | 'none'; acceptable?: Acceptable[]; fixtures?: FixtureRule[] }

export function acceptableAtRung(acceptable: Acceptable[], catalog: Catalog, names: Set<string>, rung: string | number, gbrain: boolean): string | null {
  const tools = acceptable.map((a) => a.server + '/' + a.tool);
  for (const [i, a] of acceptable.entries()) {
    if (a.server === 'gbrain') {
      if (!gbrain) return 'acceptable tool ' + tools[i] + ' needs the gbrain arm';
    } else if (!catalog.servers[a.server]?.tools.some((t) => t.name === a.tool)) {
      return 'acceptable tool ' + tools[i] + ' is not in the catalog';
    }
  }
  if (!tools.length || tools.some((t) => names.has(t)) || acceptable.some((a) => a.server === 'gbrain')) return null;
  return tools.length === 1 ? 'acceptable tool ' + tools[0] + ' is not on rung ' + rung
    : 'no acceptable tool is on rung ' + rung + ' (' + tools.join(', ') + ')';
}

const toml = (s: string) => JSON.stringify(s);
const compose$ = (s: string) => s.replace(/\$/g, '$$$$');

export function treeSha256(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string): string[] => readdirSync(d).sort().flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const f of walk(dir)) h.update(relative(dir, f) + '\0' + createHash('sha256').update(readFileSync(f)).digest('hex') + '\n');
  return h.digest('hex');
}

/** The sidecar image's build context: host.js (catalog-host.ts bundled with the MCP SDK), the catalog, the Dockerfile. */
export async function writeCatalogImage(catalogDir: string, out: string): Promise<{ dir: string; tag: string; sha256: string }> {
  const dir = join(out, 'catalog-image');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const built = await Bun.build({ entrypoints: [join(HERE, 'catalog-host.ts')], target: 'bun', minify: false });
  if (!built.success) throw new Error('HE-MCP-011 bundling catalog-host.ts failed: ' + built.logs.map(String).join('; '));
  writeFileSync(join(dir, 'host.js'), await built.outputs[0]!.text());
  cpSync(join(catalogDir, 'servers'), join(dir, 'catalog', 'servers'), { recursive: true });
  cpSync(join(catalogDir, 'ladder.json'), join(dir, 'catalog', 'ladder.json'));
  writeFileSync(join(dir, 'Dockerfile'), [
    'FROM ' + BUN_IMAGE,
    'COPY host.js /srv/host.js',
    'COPY catalog /srv/catalog',
    'RUN mkdir -p /srv/log',
    'EXPOSE ' + HOST_PORT,
    '',
  ].join('\n'));
  const sha256 = treeSha256(dir);
  return { dir, tag: 'he-mcp-catalog:' + sha256.slice(0, 16), sha256 };
}

/** The catalog service names its network so that, under Harbor's egress control, it keeps its own address and DNS name
 *  on the task network: Harbor moves every service that declares no networking into the gost sidecar's namespace, where
 *  "catalog" would not resolve (keyless Ubicloud check, 2026-11-19). The agent's container still goes through gost. */
export function compose(o: { tag: string; rung: string; request: string; fixtures: FixtureRule[]; token: string; gbrain?: ReturnType<typeof relaySidecar> }): Record<string, unknown> {
  const fixtures = JSON.stringify({ requests: { [o.request]: o.fixtures } });
  return {
    services: {
      catalog: {
        image: o.tag,
        pull_policy: 'never',
        networks: ['default'],
        command: ['bun', '/srv/host.js', '--catalog', '/srv/catalog', '--rung', o.rung, '--request', compose$(o.request), '--fixtures-env', 'HE_FIXTURES',
          '--log', '/srv/log/calls.jsonl', '--listen', 'catalog:' + HOST_PORT, '--log-token-env', 'HE_CATALOG_LOG_TOKEN'],
        environment: { HE_CATALOG_LOG_TOKEN: o.token, HE_FIXTURES: compose$(fixtures) },
        healthcheck: {
          test: ['CMD', 'bun', '-e', compose$("const r = await fetch('http://catalog:" + HOST_PORT + "/healthz'); process.exit(r.ok ? 0 : 1)")],
          interval: '2s', timeout: '5s', retries: 30, start_period: '2s',
        },
      },
      main: {
        depends_on: { catalog: { condition: 'service_healthy' }, ...(o.gbrain ? { gbrain: { condition: 'service_healthy' } } : {}) },
        ...(o.gbrain ? { volumes: ['gbrain-evidence:' + GBRAIN_EVIDENCE + ':ro'] } : {}),
      },
      ...(o.gbrain ? { gbrain: o.gbrain } : {}),
    },
    ...(o.gbrain ? { volumes: { 'gbrain-evidence': {} } } : {}),
  };
}

export interface StdioServer { name: string; command: string; args: string[] }

export function taskToml(o: { name: string; servers: string[]; token: string; agentTimeout?: number; stdio?: StdioServer[] }): string {
  const servers = [
    ...o.servers.map((s) => '{ name = ' + toml(s) + ', transport = "streamable-http", url = ' + toml('http://catalog:' + HOST_PORT + '/mcp/' + s) + ' }'),
    ...(o.stdio ?? []).map((s) => '{ name = ' + toml(s.name) + ', transport = "stdio", command = ' + toml(s.command) + ', args = [' + s.args.map(toml).join(', ') + '] }'),
  ];
  return [
    'schema_version = "1.1"',
    'artifacts = []',
    '',
    '[task]',
    'name = ' + toml('mcp-at-scale/' + o.name),
    'description = "MCP at scale (internal-task): one request against a rung of fake MCP servers on the catalog host sidecar; graded from the host call log."',
    '',
    '[metadata]',
    'author_name = "harness-evals"',
    '',
    '[verifier]',
    'timeout_sec = 120.0',
    '',
    '[agent]',
    'timeout_sec = ' + (o.agentTimeout ?? 900) + '.0',
    '',
    '[environment]',
    'build_timeout_sec = 900.0',
    'cpus = 2',
    'memory_mb = 4096',
    'storage_mb = 10240',
    'gpus = 0',
    'allow_internet = true',
    'mcp_servers = [',
    ...servers.map((s) => '  ' + s + ','),
    ']',
    '',
    '[verifier.env]',
    'HE_CATALOG_URL = ' + toml('http://catalog:' + HOST_PORT),
    'HE_CATALOG_LOG_TOKEN = ' + toml(o.token),
    '',
    '[environment.env]',
    '',
    '[solution.env]',
    '',
  ].join('\n');
}

/** A gbrain arm (gbrain.ts): the built task image and each cell's serve flags. Its tasks run at the given rungs with gbrain
 *  as one more server, launched through the logging relay, named <request>__r<rung>__gb-<cell>. */
export interface GbrainArm { image: string; cells: Record<string, string[]> }

export interface PlannedTask { request: string; rung: string; gbrainCell?: string }
const taskKey = (request: string, rung: string, gbrainCell?: string) => JSON.stringify([request, rung, gbrainCell ?? null]);

export async function materialize(o: { catalog: string; requests: McpRequest[]; rungs: string[]; out: string; build?: boolean; agentTimeout?: number; gbrain?: GbrainArm; planned?: PlannedTask[] }) {
  const cat = loadCatalog(o.catalog);
  const problems = checkCatalog(cat);
  if (problems.length) throw new Error('HE-MCP-010 the catalog has problems:\n' + problems.join('\n'));
  const image = await writeCatalogImage(o.catalog, o.out);
  writeFileSync(join(o.out, 'catalog-image.json'), JSON.stringify({ tag: image.tag, context_sha256: image.sha256, bun_image: BUN_IMAGE }, null, 1) + '\n');
  if (o.build) {
    const p = Bun.spawnSync(['docker', 'build', '-q', '-t', image.tag, image.dir], { stdout: 'pipe', stderr: 'pipe' });
    if (p.exitCode !== 0) throw new Error('HE-MCP-011 docker build of the catalog image failed: ' + p.stderr.toString().slice(-800));
  }
  const index: Array<Record<string, unknown>> = [];
  const planned = o.planned ? new Set(o.planned.map((p) => taskKey(p.request, p.rung, p.gbrainCell))) : undefined;
  for (const r of o.requests) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(r.id)) throw new Error('HE-MCP-012 request id ' + r.id + ' must be letters, digits, dot, underscore or dash');
    const variants: Array<{ suffix: string; gbrain: { cell: string; args: string[] } | null }> = o.gbrain
      ? Object.entries(o.gbrain.cells).map(([cell, args]) => ({ suffix: '__gb-' + cell, gbrain: { cell, args } }))
      : [{ suffix: '', gbrain: null }];
    for (const rung of o.rungs) for (const v of variants) {
      if (planned && !planned.has(taskKey(r.id, rung, v.gbrain?.cell))) continue;
      const servers = rungServers(cat, rung);
      const names = new Set(servers.flatMap((s) => s.tools.map((t) => s.server + '/' + t.name)));
      const unserved = acceptableAtRung(r.acceptable ?? [], cat, names, rung, v.gbrain !== null);
      if (unserved) throw new Error('HE-MCP-012 request ' + r.id + ': ' + unserved);
      const name = r.id + '__r' + rung + v.suffix;
      const relay = v.gbrain ? relayCommand() : null;
      const dir = join(o.out, 'tasks', name);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(dir, 'environment'), { recursive: true });
      mkdirSync(join(dir, 'tests'), { recursive: true });
      const token = randomBytes(24).toString('hex');
      writeFileSync(join(dir, 'instruction.md'), r.text.trimEnd() + '\n');
      writeFileSync(join(dir, 'task.toml'), taskToml({ name, servers: servers.map((s) => s.server), token, agentTimeout: o.agentTimeout, stdio: relay ? [{ name: 'gbrain', ...relay }] : [] }));
      writeFileSync(join(dir, 'environment', 'Dockerfile'), 'FROM ' + (o.gbrain ? o.gbrain.image : MAIN_IMAGE) + '\nWORKDIR /app\n');
      const gbrain = o.gbrain && v.gbrain ? relaySidecar(o.gbrain.image, v.gbrain.args, name) : undefined;
      writeFileSync(join(dir, 'environment', 'docker-compose.yaml'), JSON.stringify(compose({ tag: image.tag, rung, request: r.id, fixtures: r.fixtures ?? [], token, gbrain }), null, 1) + '\n');
      const expected: Record<string, unknown> = { request: r.id, kind: r.kind, rung, require_ready: true, servers: [...servers.map((s) => s.server), ...(v.gbrain ? ['gbrain'] : [])], acceptable: r.acceptable ?? [] };
      if (v.gbrain) Object.assign(expected, { gbrain_cell: v.gbrain.cell, gbrain_serve_args: v.gbrain.args, discovery: [{ server: 'gbrain', tool: 'request_tools' }] });
      writeFileSync(join(dir, 'tests', 'expected.json'), JSON.stringify(expected, null, 1) + '\n');
      cpSync(join(HERE, 'grade.py'), join(dir, 'tests', 'grade.py'));
      writeFileSync(join(dir, 'tests', 'test.sh'), '#!/bin/bash\nset -u\npython3 /tests/grade.py --expected /tests/expected.json --out /logs/verifier\n', { mode: 0o755 });
      index.push({ task: name, request: r.id, rung, kind: r.kind, path: relative(o.out, dir), servers: servers.length, tools: names.size, ...(v.gbrain ? { gbrain_cell: v.gbrain.cell } : {}) });
    }
  }
  writeFileSync(join(o.out, 'tasks.json'), JSON.stringify({ catalog_image: image.tag, tasks: index }, null, 1) + '\n');
  return { image, tasks: index };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const catalog = flag('--catalog');
  const requestsFile = flag('--requests');
  const out = flag('--out');
  if (!catalog || !requestsFile || !out) {
    console.error('usage: materialize.ts --catalog <dir> --requests <requests.json> --rungs 30,75,150,300 --out <dir> [--ids a,b] [--build]');
    process.exit(2);
  }
  const ids = flag('--ids')?.split(',');
  const all = (JSON.parse(readFileSync(requestsFile, 'utf8')) as { requests: McpRequest[] }).requests;
  const requests = ids ? all.filter((r) => ids.includes(r.id)) : all;
  mkdirSync(out, { recursive: true });
  const res = await materialize({ catalog, requests, rungs: (flag('--rungs') ?? '30,75,150,300').split(','), out, build: argv.includes('--build') });
  console.log('materialized ' + res.tasks.length + ' task(s); catalog image ' + res.image.tag + (argv.includes('--build') ? ' (built)' : ' (not built; pass --build)'));
}
