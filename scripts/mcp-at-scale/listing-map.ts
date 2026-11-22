#!/usr/bin/env bun
// The keyless MCP listing map (internal-task plan, "The free listing probe" and outcome 8): one turn per harness cell per rung,
// through the Harbor cells (scripts/mcp-at-scale/agents.py on tasks from materialize.ts, the catalog host as a sidecar),
// against a keyless upstream (upstream.ts: fake-upstream.ts's reply, so the first answer is text and the turn ends). From
// each trial's first agent-loop request (scripts/frontier-harbor/gstack-exposure.ts agentLoopRequests) it records, for
// every catalog tool of the rung, where the tool is in what the model sees:
//   full_schema  declared to the model as a tool with its input schema
//   description  its name and the start of its description appear (a listing line, a search tool's description)
//   name_only    its name appears, attributed to its server (qualified, or under the server's name)
//   server_only  only its server's name appears
//   absent       neither
// plus the first request's characters (an estimate of tokens at four characters per token, as the probe did) and, from the
// verifier's outcomes.json, which rung servers the harness connected (initialize and tools/list in the host log).
//
//   bun scripts/mcp-at-scale/listing-map.ts run --out <dir> [--catalog <dir>] [--variants a,b] [--rungs 30,75,150,300]
//       [--concurrency 3] [--venv <harbor venv>] [--search] [--versions codex=0.170.0,openclaw=2026.11.5]
//   --gbrain <dir from gbrain.ts build | build> [--gbrain-cells full,starter,verbs,registered] adds gbrain as one more
//   server through its logging relay, one job per cell (job and task names end in __gb-<cell>); use with --rungs 150.
//   --egress runs every trial in scripts/frontier-harbor/egress.py BlocklistDockerEnvironment (the gost sidecar and the
//   frontier blocklist in front of the task containers), which needs a kernel with nftables fib inet (a Ubicloud VM).
//   --reply-delay-ms N holds each fake model reply N ms, as a real model would: a harness that does not wait for its MCP
//   servers before the first request (Codex) otherwise ends the turn before a slow stdio server such as gbrain answers.
//   --versions runs a harness at another release than scripts/frontier-harbor/pin.json's (the job name says which).
//   bun scripts/mcp-at-scale/listing-map.ts analyze --out <dir>
//
// Without --catalog the synthetic catalog (catalog-load.ts) is written to <out>/catalog. Writes <out>/listing-map.json
// (rows per variant and rung) and <out>/listing-map-tools.jsonl (the place of every tool). QM is listed and skipped: see
// SKIPPED below. --search runs SEARCH_REQUEST against the scripted model instead (the search-effort fixtures).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { agentLoopRequests, type CapturedRequest } from '../frontier-harbor/gstack-exposure.ts';
import { loadCatalog, rungServers, syntheticCatalog, writeCatalog, type Catalog } from './catalog-load.ts';
import { materialize, type McpRequest } from './materialize.ts';
import { startUpstream } from './upstream.ts';
import { buildGbrain, GBRAIN_CELLS } from './gbrain.ts';
import { bodyText, declaredWithSchemas } from './request-shape.ts';

export { bodyText, declaredWithSchemas };

const HERE = import.meta.dir;
const REPO = resolve(HERE, '../..');

/** Each cell: Harbor class in scripts/mcp-at-scale/agents.py, pin.json harness and the cell model. */
export const VARIANTS: Record<string, { cls: string; harness: string; model: string }> = {
  'claude-code': { cls: 'McpClaudeCode', harness: 'claude-code', model: 'anthropic/claude-opus-5-5' },
  'claude-code-no-tool-search': { cls: 'McpClaudeCodeNoToolSearch', harness: 'claude-code', model: 'anthropic/claude-opus-5-5' },
  codex: { cls: 'McpCodex', harness: 'codex', model: 'openai/gpt-6.2-sol' },
  hermes: { cls: 'McpHermes', harness: 'hermes', model: 'anthropic/claude-opus-5-5' },
  openclaw: { cls: 'McpOpenClaw', harness: 'openclaw', model: 'anthropic/claude-opus-5-5' },
  'pi-codemode': { cls: 'McpPi', harness: 'pi', model: 'anthropic/claude-opus-5-5' },
  'pi-deferred': { cls: 'McpPiDeferred', harness: 'pi', model: 'anthropic/claude-opus-5-5' },
  'pi-direct': { cls: 'McpPiDirect', harness: 'pi', model: 'anthropic/claude-opus-5-5' },
  'gemini-cli': { cls: 'McpGeminiCli', harness: 'gemini-cli', model: 'google/gemini-4-carbon' },
};
/** Harnesses the map names but cannot run yet, with the reason. QM: when internal-task's Harbor class lands, add an McpQm class
 *  in agents.py (catalog servers registered through QM's admin API, the host's origin in PRIVATE_NETWORK_ALLOWED_ORIGINS)
 *  and a "qm" entry in VARIANTS, and drop it here. */
export const SKIPPED: Record<string, string> = {
  qm: 'skipped: QM has no Harbor class yet; internal-task is adding QM to the Harbor runner (handoffs/internal-task/qm-harness.md)',
};

export const LISTING_REQUEST: McpRequest = { id: 'listing', text: 'Reply with the single word ready.', kind: 'none' };

/** The search-effort capture (run --search): a tool request the scripted model (search-script.ts) answers by searching
 *  for the target with each harness's own mechanism and calling it. */
export const SEARCH_REQUEST: McpRequest = {
  id: 'search-probe', text: 'In the Ash Tracker workspace acme, create an issue titled Login button broken.', kind: 'tool',
  acceptable: [{ server: 'ash-tracker', tool: 'create_issue', required: { workspace: { $ci: 'acme' }, title: { $contains: 'login' } } }],
  fixtures: [{ id: 'created', server: 'ash-tracker', tool: 'create_issue', match: { workspace: { $ci: 'acme' } }, result: { json: { issue_id: 'ACME-7', status: 'open' } } }],
};
export const SEARCH_TARGET = { server: 'ash-tracker', tool: 'create_issue', args: { workspace: 'acme', title: 'Login button broken' }, query: 'ash tracker create issue' };

export type Place = 'full_schema' | 'description' | 'name_only' | 'server_only' | 'absent';
export const PLACES: Place[] = ['full_schema', 'description', 'name_only', 'server_only', 'absent'];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** The place of every rung tool in one request body. A bare tool name is attributed to the nearest server name before it
 *  in the text, so a near-twin's tool of the same name counts only for its own server. The description test looks for
 *  the first 40 normalized characters of the description's first sentence (harnesses that list one line per tool cut at
 *  the first sentence or sooner). */
export function classify(body: Record<string, any>, servers: Array<{ server: string; tools: Array<{ name: string; description: string; inputSchema: any }> }>): Map<string, Place> {
  const declared = declaredWithSchemas(body).map((d) => ({ n: norm(d.name), props: Object.keys(d.schema?.properties ?? {}) }));
  const text = '_' + norm(bodyText(body).join('\n')) + '_';
  const serverPos: Array<[number, string]> = [];
  for (const s of servers) {
    const key = '_' + norm(s.server) + '_';
    for (let i = text.indexOf(key); i >= 0; i = text.indexOf(key, i + 1)) serverPos.push([i, s.server]);
  }
  serverPos.sort((a, b) => a[0] - b[0]);
  const nearest = (p: number) => { let best: string | null = null; for (const [i, s] of serverPos) { if (i < p) best = s; else break; } return best; };
  const out = new Map<string, Place>();
  for (const s of servers) {
    const sn = norm(s.server);
    const named = serverPos.some(([, x]) => x === s.server);
    for (const t of s.tools) {
      const tn = norm(t.name);
      const props = Object.keys(t.inputSchema?.properties ?? {});
      const full = declared.some((d) => d.n.endsWith('_' + tn) && d.n.includes(sn) && props.every((p) => d.props.includes(p)));
      let place: Place = 'absent';
      if (full) place = 'full_schema';
      else {
        const key = '_' + tn + '_';
        let nameSeen = false;
        for (let i = text.indexOf(key); i >= 0 && !nameSeen; i = text.indexOf(key, i + 1)) if (nearest(i + 1) === s.server) nameSeen = true;
        const desc = norm(t.description.split(/\.\s/)[0]!).slice(0, 40);
        if (nameSeen && desc && text.includes(desc)) place = 'description';
        else if (nameSeen) place = 'name_only';
        else if (named) place = 'server_only';
      }
      out.set(s.server + '/' + t.name, place);
    }
  }
  return out;
}

interface Row {
  job: string;
  variant: string; version: string; rung: string; gbrain_cell?: string; gbrain_counts?: Record<Place, number>; tools: number; trial: string | null; first_request_chars: number | null; est_tokens: number | null;
  counts: Record<Place, number>; servers_connected: number | null; servers_expected: number; infra: unknown; requests: number; note?: string;
}

export function analyze(out: string): { rows: Row[]; perTool: Array<Record<string, unknown>> } {
  const manifest = JSON.parse(readFileSync(join(out, 'listing-run.json'), 'utf8')) as { jobs: Array<{ job: string; variant: string; rung: string; model: string; version: string; gbrain_cell?: string }> };
  const cat = loadCatalog(join(out, 'catalog'));
  const bodiesBy = new Map<string, CapturedRequest[]>();
  const bodiesFile = join(out, 'upstream-bodies.jsonl');
  if (existsSync(bodiesFile)) for (const line of readFileSync(bodiesFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as { trial: string | null; path: string; body: string };
    if (!e.trial) continue;
    let body: Record<string, any> | null = null;
    try { body = JSON.parse(e.body); } catch { body = null; }
    const gemini = /\/models\/([A-Za-z0-9._-]+):(?:stream)?[Gg]enerateContent$/.exec(e.path);
    if (body && gemini && !body.model) body.model = gemini[1];
    const list = bodiesBy.get(e.trial) ?? [];
    list.push({ route: e.path, body, bytes: e.body.length });
    bodiesBy.set(e.trial, list);
  }
  const rows: Row[] = [];
  const perTool: Array<Record<string, unknown>> = [];
  for (const j of manifest.jobs) {
    const servers = [...rungServers(cat, j.rung), ...(j.gbrain_cell ? [gbrainServer(out, j.gbrain_cell)] : [])];
    const tools = servers.reduce((n, s) => n + s.tools.length, 0);
    const jobDir = join(out, 'jobs', j.job);
    const trial = existsSync(jobDir) ? readdirSync(jobDir).find((d) => existsSync(join(jobDir, d, 'agent')) || existsSync(join(jobDir, d, 'verifier'))) ?? null : null;
    const outcomes = trial && existsSync(join(jobDir, trial, 'verifier', 'outcomes.json')) ? JSON.parse(readFileSync(join(jobDir, trial, 'verifier', 'outcomes.json'), 'utf8')) : null;
    const counts = Object.fromEntries(PLACES.map((p) => [p, 0])) as Record<Place, number>;
    const requests = trial ? bodiesBy.get(trial) ?? [] : [];
    const cellModel = j.model.replace('/', ':');
    const first = agentLoopRequests(requests, cellModel)[0];
    const row: Row = { job: j.job, variant: j.variant, version: j.version, rung: j.rung, tools, trial, first_request_chars: null, est_tokens: null, counts, servers_connected: outcomes ? outcomes.servers_connected.length : null, servers_expected: servers.length, infra: outcomes ? outcomes.infra : trial ? 'no verifier outcome' : 'no trial', requests: requests.length };
    if (first) {
      const chars = JSON.stringify(first.body).length;
      row.first_request_chars = chars;
      row.est_tokens = Math.round(chars / 4);
      if (j.gbrain_cell) { row.gbrain_cell = j.gbrain_cell; row.gbrain_counts = Object.fromEntries(PLACES.map((p) => [p, 0])) as Record<Place, number>; }
      for (const [k, place] of classify(first.body, servers)) {
        if (row.gbrain_counts && k.startsWith('gbrain/')) row.gbrain_counts[place] += 1;
        else counts[place] += 1;
        perTool.push({ variant: j.variant, rung: j.rung, ...(j.gbrain_cell ? { gbrain_cell: j.gbrain_cell } : {}), tool: k, place });
      }
    } else row.note = 'no agent-loop request captured';
    if (j.gbrain_cell) row.gbrain_cell = j.gbrain_cell;
    rows.push(row);
  }
  return { rows, perTool };
}

/** gbrain as one more server for classify: every tool the cell's --surface makes callable (an advertised-only cell's
 *  other tools then count as absent or name-only), from the gbrain build's tools/list dumps copied into <out>/gbrain. */
export function gbrainServer(out: string, cell: string): { server: string; tools: Array<{ name: string; description: string; inputSchema: any }> } {
  const image = JSON.parse(readFileSync(join(out, 'gbrain', 'gbrain-image.json'), 'utf8'));
  const args: string[] = image.cells[cell].serve_args;
  const surface = args[args.indexOf('--surface') + 1]!;
  const dump = JSON.parse(readFileSync(join(out, 'gbrain', 'gbrain-tools-' + surface + '.json'), 'utf8'));
  return { server: 'gbrain', tools: dump.tools.map((t: any) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema })) };
}

async function runJobs(o: { out: string; venv: string; jobs: string[]; concurrency: number }): Promise<number> {
  const env = { PATH: [join(o.venv, 'bin'), '/usr/local/bin', '/usr/bin', '/bin'].join(':'), HOME: process.env.HOME ?? '/tmp', TZ: 'UTC', PYTHONPATH: [join(REPO, 'scripts/mcp-at-scale'), join(REPO, 'scripts/frontier-harbor')].join(':'), PYTHONDONTWRITEBYTECODE: '1' };
  const queue = [...o.jobs];
  let failed = 0;
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const p = Bun.spawn([join(o.venv, 'bin/harbor'), 'run', '-y', '-c', join(o.out, 'configs', job + '.json')], { cwd: o.out, env, stdout: Bun.file(join(o.out, 'logs', job + '.log')), stderr: 'pipe' });
      const code = await p.exited;
      if (code !== 0) failed++;
      const err = await new Response(p.stderr).text();
      if (err) writeFileSync(join(o.out, 'logs', job + '.stderr'), err);
      console.log(new Date().toISOString() + ' ' + job + ' exited ' + code);
    }
  };
  await Promise.all(Array.from({ length: o.concurrency }, worker));
  return failed;
}

export function gatewayIp(): string {
  const p = Bun.spawnSync(['docker', 'network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { stdout: 'pipe' });
  const ip = p.stdout.toString().trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error('HE-MCP-013 cannot read the docker bridge gateway: ' + ip);
  return ip;
}

/** Writes one Harbor job config per cell and rung, on the plain docker environment with the verifier on. */
export const EGRESS_ENVIRONMENT = 'egress:BlocklistDockerEnvironment';

export function writeJobs(o: { out: string; variants: string[]; rungs: string[]; brokerPort: number; requestId: string; versions?: Record<string, string>; gbrainCells?: string[]; egress?: boolean }): Array<{ job: string; variant: string; rung: string; model: string; version: string; gbrain_cell?: string }> {
  const pin = JSON.parse(readFileSync(join(REPO, 'scripts/frontier-harbor/pin.json'), 'utf8'));
  mkdirSync(join(o.out, 'configs'), { recursive: true });
  mkdirSync(join(o.out, 'logs'), { recursive: true });
  const jobs: Array<{ job: string; variant: string; rung: string; model: string; version: string; gbrain_cell?: string }> = [];
  for (const v of o.variants) {
    const c = VARIANTS[v];
    if (!c) throw new Error('unknown variant ' + v + (SKIPPED[v] ? ' (' + SKIPPED[v] + ')' : '') + '; known: ' + Object.keys(VARIANTS).join(', '));
    for (const rung of o.rungs) for (const cell of o.gbrainCells ?? [null]) {
      const pinned = String(pin.harnesses[c.harness].version);
      const version = o.versions?.[c.harness] ?? pinned;
      const suffix = cell ? '__gb-' + cell : '';
      const job = v + (version === pinned ? '' : '-v' + version) + '__r' + rung + suffix;
      const config = {
        job_name: job, jobs_dir: join(o.out, 'jobs'), n_attempts: 1, n_concurrent_trials: 1, quiet: true, retry: { max_retries: 0 },
        environment: { import_path: o.egress ? EGRESS_ENVIRONMENT : 'harbor.environments.docker.docker:DockerEnvironment', delete: true },
        verifier: { disable: false },
        agents: [{ name: 'mcp-' + v, import_path: 'agents:' + c.cls, model_name: c.model,
          kwargs: { version, broker_url: 'http://127.0.0.1:' + o.brokerPort, cell: 'mcp-' + v + '-r' + rung + suffix, attempt: 1 } }],
        tasks: [{ path: join(o.out, 'tasks', o.requestId + '__r' + rung + suffix) }],
      };
      writeFileSync(join(o.out, 'configs', job + '.json'), JSON.stringify(config, null, 2) + '\n');
      jobs.push({ job, variant: v, rung, model: c.model, version, ...(cell ? { gbrain_cell: cell } : {}) });
    }
  }
  return jobs;
}

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const out = flag('--out') ? resolve(flag('--out')!) : null;
  if (!out || (cmd !== 'run' && cmd !== 'analyze')) {
    console.error('usage: listing-map.ts run --out <dir> [--catalog <dir>] [--variants a,b] [--rungs 30,75,150,300] [--concurrency 3] [--venv <dir>] | analyze --out <dir>');
    process.exit(2);
  }
  if (cmd === 'run') {
    mkdirSync(out, { recursive: true });
    const catalogDir = join(out, 'catalog');
    const cat: Catalog = flag('--catalog') ? loadCatalog(flag('--catalog')!) : syntheticCatalog();
    writeCatalog(catalogDir, cat);
    const rungs = (flag('--rungs') ?? '30,75,150,300').split(',');
    const variants = (flag('--variants') ?? Object.keys(VARIANTS).join(',')).split(',');
    const venv = flag('--venv') ?? join(process.env.HOME ?? '', '.frontier-harbor/venv');
    const search = argv.includes('--search');
    const request = search ? SEARCH_REQUEST : LISTING_REQUEST;
    const gbrainDir = flag('--gbrain');
    let gbrain: { image: string; cells: Record<string, string[]> } | undefined;
    const gbrainCells = gbrainDir ? (flag('--gbrain-cells') ?? GBRAIN_CELLS.join(',')).split(',') : undefined;
    if (gbrainDir) {
      const src = gbrainDir === 'build' ? join(out, 'gbrain') : resolve(gbrainDir);
      if (gbrainDir === 'build') await buildGbrain(src);
      else { mkdirSync(join(out, 'gbrain'), { recursive: true }); for (const f of readdirSync(src)) if (f.startsWith('gbrain-')) cpSync(join(src, f), join(out, 'gbrain', f), { recursive: true }); }
      const image = JSON.parse(readFileSync(join(out, 'gbrain', 'gbrain-image.json'), 'utf8'));
      gbrain = { image: image.tag, cells: Object.fromEntries(gbrainCells!.map((c) => [c, image.cells[c].serve_args])) };
    }
    await materialize({ catalog: catalogDir, requests: [request], rungs, out, build: true, agentTimeout: 900, gbrain });
    const gateway = gatewayIp();
    const brokerPort = Number(flag('--broker-port') ?? 8791);
    const port = Number(flag('--port') ?? 8799);
    const up = startUpstream({ gateway, port, brokerPort, bodies: join(out, 'upstream-bodies.jsonl'), mode: search ? 'search' : 'listing', target: SEARCH_TARGET, replyDelayMs: Number(flag('--reply-delay-ms') ?? 0) });
    const versions = Object.fromEntries((flag('--versions') ?? '').split(',').filter(Boolean).map((kv) => kv.split('=') as [string, string]));
    const egress = argv.includes('--egress');
    const jobs = writeJobs({ out, variants, rungs, brokerPort, requestId: request.id, versions, gbrainCells, egress });
    writeFileSync(join(out, 'listing-run.json'), JSON.stringify({ started: new Date().toISOString(), catalog: flag('--catalog') ?? 'synthetic', mode: search ? 'search' : 'listing', environment: egress ? EGRESS_ENVIRONMENT : 'docker', jobs, skipped: SKIPPED }, null, 1) + '\n');
    try {
      const failed = await runJobs({ out, venv, jobs: jobs.map((j) => j.job), concurrency: Number(flag('--concurrency') ?? 3) });
      if (egress && failed) process.exitCode = 1;
    } finally { up.stop(); }
  }
  const { rows, perTool } = analyze(out);
  writeFileSync(join(out, 'listing-map.json'), JSON.stringify({ generated: new Date().toISOString(), places: PLACES, rows, skipped: SKIPPED }, null, 1) + '\n');
  writeFileSync(join(out, 'listing-map-tools.jsonl'), perTool.map((r) => JSON.stringify(r)).join('\n') + '\n');
  for (const r of rows) console.log([r.variant + '@' + r.version + (r.gbrain_cell ? ' gb-' + r.gbrain_cell : ''), r.rung, r.tools, r.est_tokens ?? '-', PLACES.map((p) => p + '=' + r.counts[p]).join(' '), 'connected=' + r.servers_connected + '/' + r.servers_expected, r.gbrain_counts ? 'gbrain: ' + PLACES.map((p) => p + '=' + r.gbrain_counts![p]).join(' ') : '', r.infra ? JSON.stringify(r.infra) : ''].join('\t'));
}
