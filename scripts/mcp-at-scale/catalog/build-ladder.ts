#!/usr/bin/env bun
// Builds the nested tool ladder (30, 75, 150, 300 tools) from the captured servers, copies each kept server's licence
// and NOTICE files at its pinned commit into LICENSES/, writes the modification notices and the README, then leaves
// the leak scan and hash file to scan.ts. Deterministic: the same servers/*.json and the same SEED give the same files.
//
//   bun scripts/mcp-at-scale/catalog/build-ladder.ts [--work <capture dir>] && bun scripts/mcp-at-scale/catalog/scan.ts
// It reads licence files from the source caches capture.ts left in --work.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_WORK, SOURCES, SURVEY_EXCLUDED, type Source } from './sources.ts';

const CATALOG = resolve(import.meta.dir, '../../../tasks/mcp-at-scale/catalog');
const WORK = process.argv.includes('--work') ? resolve(process.argv[process.argv.indexOf('--work') + 1]) : DEFAULT_WORK;
export const SEED = 20261119;
export const TARGETS = [30, 75, 150, 300];
export const TOLERANCE = 5;
export const NAMING_RULE = 'each server is named after its upstream package or folder with the mcp and server words dropped (github-mcp-server is github, mcp-grafana is grafana, cloudwatch-mcp-server is cloudwatch); the one clash, two Slack servers, keeps slack for korotovsky/slack-mcp-server and names the archived reference server, which runs on a bot token, slack-bot';
export const PREFIX = (server: string, tool: string) => `${server}__${tool}`;

// The 30 target tools: six servers spread through the alphabet of the full server list, each trimmed with its own
// switch to five tools that do different jobs from every other core tool.
export const CORE: { server: string; job: string; tools: string[]; switch: string }[] = [
  { server: 'atlassian', job: 'wiki pages (Confluence)', tools: ['confluence_search', 'confluence_get_page', 'confluence_get_page_children', 'confluence_create_page', 'confluence_update_page'], switch: 'ENABLED_TOOLS=confluence_search,confluence_get_page,confluence_get_page_children,confluence_create_page,confluence_update_page' },
  { server: 'github', job: 'code hosting: issues, pull requests, commits', tools: ['list_issues', 'issue_write', 'create_pull_request', 'merge_pull_request', 'list_commits'], switch: '--tools list_issues,issue_write,create_pull_request,merge_pull_request,list_commits' },
  { server: 'grafana', job: 'incident management', tools: ['add_activity_to_incident', 'create_incident', 'get_incident', 'list_incident_custom_fields', 'list_incidents', 'update_incident'], switch: '--enabled-tools=incident' },
  { server: 'mongodb', job: 'document database queries and writes', tools: ['aggregate', 'find', 'insert-many', 'list-collections', 'update-many'], switch: 'MDB_MCP_DISABLED_TOOLS set to every other tool name (22 names, listed in servers/mongodb.json core_filter)' },
  { server: 'slack', job: 'team chat', tools: ['channels_list', 'conversations_history', 'conversations_add_message', 'conversations_search_messages'], switch: 'SLACK_MCP_ENABLED_TOOLS=channels_list,conversations_history,conversations_add_message,conversations_search_messages' },
  { server: 'terraform', job: 'infrastructure registry lookups', tools: ['search_provider_docs', 'get_provider_details', 'search_modules', 'get_module_details', 'search_policies'], switch: '--tools=search_provider_docs,get_provider_details,search_modules,get_module_details,search_policies' },
];

// Distractor servers that do the same kind of job as a core server.
export const TWINS: Record<string, string> = {
  gitlab: 'github',
  linear: 'github',
  'slack-bot': 'slack',
  mattermost: 'slack',
  teams: 'slack',
  postgres: 'mongodb',
  sqlite: 'mongodb',
  dynamodb: 'mongodb',
  notion: 'atlassian',
  cloudwatch: 'grafana',
  sentry: 'grafana',
};

type ServerFile = {
  server: string;
  source: { repo: string; commit: string; path: string; spdx: string; licence_file: string; notice_file: string | null; capture_method: string };
  job: string;
  tools: { name: string; description: string }[];
  excluded_tools: { name: string; reason: string }[];
  core_filter?: { switch: string; args: string[]; env: Record<string, string>; tools: string[] };
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function loadServers(): Map<string, ServerFile> {
  const dir = join(CATALOG, 'servers');
  return new Map(readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ServerFile).map((s) => [s.server, s]));
}

export function buildLadder(servers: Map<string, ServerFile>) {
  const alphabet = [...servers.keys()].sort();
  const core = CORE.map((c) => {
    const s = servers.get(c.server);
    if (!s) throw new Error(`core server ${c.server} has no capture`);
    const names = new Set(s.tools.map((t) => t.name));
    for (const t of c.tools) if (!names.has(t)) throw new Error(`core tool ${c.server}.${t} is not in its capture`);
    const filtered = s.core_filter?.tools;
    const verified = !!filtered && filtered.length === c.tools.length && c.tools.every((t) => filtered.includes(t));
    return { server: c.server, position: alphabet.indexOf(c.server) + 1, job: c.job, switch: c.switch, filter_verified_by_capture: verified, tools: c.tools };
  });
  const coreSet = new Set(CORE.map((c) => c.server));
  const size = (n: string) => servers.get(n)!.tools.length;
  type Rung = { target: number; size: number; added: string[]; servers: { server: string; role: string; twin_of?: string; tools: string[] }[]; tool_names: string[] };
  const attempt = (seed: number): { order: string[]; rungs: Rung[] } | null => {
    const rand = mulberry32(seed);
    const twins = shuffle(alphabet.filter((n) => !coreSet.has(n) && TWINS[n]), rand);
    const unrelated = shuffle(alphabet.filter((n) => !coreSet.has(n) && !TWINS[n]), rand);
    const order: string[] = [];
    let ti = 0; let ui = 0;
    while (ti < twins.length || ui < unrelated.length) {
      const takeTwin = ui >= unrelated.length || (ti < twins.length && ti / twins.length <= ui / unrelated.length);
      order.push(takeTwin ? twins[ti++] : unrelated[ui++]);
    }
    const queue = [...order];
    let members: Rung['servers'] = core.map((c) => ({ server: c.server, role: 'core', tools: c.tools }));
    let total = members.reduce((acc, m) => acc + m.tools.length, 0);
    const rungs: Rung[] = [{ target: TARGETS[0], size: total, added: core.map((c) => c.server), servers: members, tool_names: [] }];
    for (const target of TARGETS.slice(1)) {
      const added: string[] = [];
      for (let i = 0; i < queue.length && total < target - TOLERANCE;) {
        const n = queue[i];
        if (total + size(n) <= target + TOLERANCE) { added.push(n); total += size(n); queue.splice(i, 1); } else i++;
      }
      if (total < target - TOLERANCE) return null;
      if (!added.some((n) => TWINS[n]) || !added.some((n) => !TWINS[n])) return null;
      members = [...members, ...added.map((n) => ({ server: n, role: TWINS[n] ? 'twin' : 'unrelated', ...(TWINS[n] ? { twin_of: TWINS[n] } : {}), tools: servers.get(n)!.tools.map((x) => x.name) }))];
      rungs.push({ target, size: total, added, servers: members, tool_names: [] });
    }
    const top = new Set(rungs[rungs.length - 1].servers.map((m) => m.server));
    for (const c of CORE) if (Object.entries(TWINS).some(([, of]) => of === c.server) && !Object.entries(TWINS).some(([n, of]) => of === c.server && top.has(n))) return null;
    return { order, rungs };
  };
  let seed = SEED;
  let found = attempt(seed);
  while (!found && seed < SEED + 1000) found = attempt(++seed);
  if (!found) throw new Error(`no seed from ${SEED} to ${SEED + 1000} gives a valid ladder`);
  const { order, rungs } = found;
  for (const r of rungs) {
    r.tool_names = r.servers.flatMap((m) => m.tools.map((t) => PREFIX(m.server, t)));
    const dup = r.tool_names.filter((n, i) => r.tool_names.indexOf(n) !== i);
    if (dup.length) throw new Error(`rung ${r.target}: duplicate prefixed tool names ${dup.join(', ')}`);
    if (Math.abs(r.size - r.target) > TOLERANCE) throw new Error(`rung ${r.target} has ${r.size} tools`);
  }
  const bareCollisions = (r: (typeof rungs)[number]) => {
    const seen = new Map<string, string[]>();
    for (const m of r.servers) for (const t of m.tools) seen.set(t, [...(seen.get(t) ?? []), m.server]);
    return [...seen].filter(([, v]) => v.length > 1).map(([tool, on]) => ({ tool, servers: on }));
  };
  return {
    seed,
    seed_search: `seeds are tried upward from ${SEED}; the first one whose every rung lands within ${TOLERANCE} tools of its target adds at least one near-twin and one unrelated server, and whose top rung holds a near-twin of every core server that has one, is used (${seed - SEED} rejected)`,
    tolerance: TOLERANCE,
    naming_rule: NAMING_RULE,
    prefix_rule: 'a harness sees each tool as <server>__<tool> (Claude Code adds mcp__ in front); names are unique per rung under that rule',
    rung_rule: `core first; then distractor servers are taken whole in distractor_order, and a server is added to a rung when it keeps the rung at or under target + ${TOLERANCE}; a server that would overshoot waits for the next rung; a rung closes once it reaches target - ${TOLERANCE}`,
    order_rule: `twins and unrelated servers are each shuffled with mulberry32(seed), then interleaved so both kinds are spread evenly through the order`,
    servers_alphabetical: alphabet.map((n, i) => ({ position: i + 1, server: n, tools: size(n) })),
    core,
    distractor_order: order.map((n) => ({ server: n, kind: TWINS[n] ? 'twin' : 'unrelated', ...(TWINS[n] ? { twin_of: TWINS[n] } : {}), tools: size(n) })),
    rungs: rungs.map((r) => ({
      target: r.target, size: r.size, servers_count: r.servers.length, added: r.added,
      servers: r.servers.map((m) => ({ server: m.server, role: m.role, ...('twin_of' in m ? { twin_of: (m as any).twin_of } : {}), tools: m.tools.length })),
      longest_name_with_claude_prefix: Math.max(...r.tool_names.map((n) => `mcp__${n}`.length)),
      names_over_64_with_claude_prefix: r.tool_names.filter((n) => `mcp__${n}`.length > 64),
      bare_name_collisions: bareCollisions(r),
      tool_names: r.tool_names,
    })),
  };
}

export function readme(servers: Map<string, ServerFile>, ladder: ReturnType<typeof buildLadder>) {
  const sv = survey(servers);
  const rows = sv.kept.map((k) => `| \`${k.server}\` | [${k.repo}](https://github.com/${k.repo}/tree/${k.commit}${k.path ? `/${k.path}` : ''}) | \`${k.commit.slice(0, 12)}\` | ${k.spdx} | ${k.capture_method} | ${k.tools} |`);
  const core = ladder.core.map((c) => `| \`${c.server}\` | ${c.job} | ${c.tools.length} | ${c.switch.replaceAll('|', '\|')} |`);
  const code = (x: string) => `\`${x}\``;
  const rungs = ladder.rungs.map((r) => `| ${r.target} | ${r.size} | ${r.servers_count} | ${r.added.map(code).join(', ')} |`);
  return [
    '# MCP tool catalog for the tools-at-scale test',
    '',
    `**What this is:** the tool lists of ${sv.kept.length} public, open-source MCP servers, captured once at pinned commits, and a nested ladder of 30, 75, 150 and 300 tools built from them. Our fake MCP servers replay these exact tool definitions so every harness sees real-world tool names, descriptions and schemas, while every call lands in a log we grade.`,
    '',
    '- **Nothing here is a credential or private data.** Placeholders such as \`placeholder-not-a-credential\` and \`example.com\` hosts were the only settings any server got. The leak scan result is in \`leak-scan.json\`.',
    '- **Licences:** every server keeps its own licence. The texts, Apache-2.0 NOTICE files and our modification notices are in \`LICENSES/\`.',
    '- **Integrity:** \`SHA256SUMS\` has the sha256 of every file here.',
    '',
    '## Where each server came from',
    '',
    '| Server name here | Source | Commit | Licence (SPDX) | Capture | Tools |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    '"runtime" means the server was built from source and asked for \`initialize\` and \`tools/list\` over stdio. "static" means the stock server would not list tools without a real credential, so the definitions were read from the pinned source another way; \`capture.static_via\` in that server\'s file says exactly how.',
    '',
    '## The ladder (\`ladder.json\`)',
    '',
    '**Core (rung 30):** six servers spread through the alphabet of the list above, each trimmed with the switch a user would set, so that no two core tools do the same job. Every test request targets a core tool, so every request runs at every rung.',
    '',
    '| Core server | Job | Tools | Switch a user sets |',
    '|---|---|---|---|',
    ...core,
    '',
    `**Bigger rungs** add whole servers (default settings) in a fixed seeded order (seed ${ladder.seed}), mixing near-twins of core servers (a second code host or issue tracker, other chat apps, other databases, a second wiki, other observability tools) with unrelated servers. Each rung contains the one below it. Sizes may land within ${ladder.tolerance} tools of the target.`,
    '',
    '| Target | Tools | Servers | Servers added at this rung |',
    '|---|---|---|---|',
    ...rungs,
    '',
    `Server names follow one rule: ${NAMING_RULE}.`,
    '',
    'Tool names are unique on every rung once the server name is put in front (\`<server>__<tool>\`). Some bare names repeat across servers (\`bare_name_collisions\` in ladder.json); that is realistic and is part of the test.',
    '',
    '## How the capture was sandboxed',
    '',
    '1. The source at the pinned commit was exported with \`git archive\` and copied into a throwaway Docker container with \`docker cp\` (no volume mounts).',
    '2. Install ran on an internal Docker network whose only way out was a logging proxy that allows the package registries alone (npm, PyPI, the Go module proxy). npm and pnpm ran with lifecycle scripts off.',
    '3. The server then ran from that container with \`--network none\`, all capabilities dropped, and only the placeholder settings listed in its file. Our capture client spoke MCP to it over stdin and stdout.',
    '',
    '## What was left out, and why',
    '',
    ...sv.excluded.map((e) => `- **${e.repo}**${e.licence ? ` (${e.licence})` : ''}: ${e.reason}.`),
    '- No single tool was dropped from a kept server: none duplicates the harness built-ins (local files, a shell, web fetch, git on the local disk). Remote file tools such as GitHub\'s \`get_file_contents\` act on a hosted service, not the local disk.',
    '',
    '## Rebuild and check',
    '',
    '\`\`\`sh',
    'bun scripts/mcp-at-scale/catalog/capture.ts        # needs Docker; spends nothing, uses no keys',
    'bun scripts/mcp-at-scale/catalog/build-ladder.ts   # ladder.json, LICENSES/, this README',
    'bun scripts/mcp-at-scale/catalog/scan.ts           # leak-scan.json, SHA256SUMS',
    'bun test tests/mcp-at-scale-catalog.test.ts',
    '\`\`\`',
    '',
    'Installs use each repository\'s own lockfile (npm ci, pnpm --frozen-lockfile, uv sync --frozen, go.sum), and each file records the base image digest, so a re-capture should list the same tools. build-ladder.ts reads licence texts from the source caches that capture.ts leaves in its work folder.',
    '',
  ].join('\n');
}

function repoSlug(repo: string) { return repo.replace('/', '__'); }

function git(s: Source, args: string[]): string | null {
  const dir = join(WORK, 'src', s.repo.replace('/', '_'));
  const p = Bun.spawnSync(['git', '-C', dir, ...args], { env: { PATH: '/usr/bin:/bin', HOME: homedir() }, stdout: 'pipe', stderr: 'pipe' });
  return p.exitCode === 0 ? p.stdout.toString() : null;
}

function gitShow(s: Source, path: string): string | null {
  const dir = join(WORK, 'src', s.repo.replace('/', '_'));
  const p = Bun.spawnSync(['git', '-C', dir, 'show', `${s.commit}:${path}`], { env: { PATH: '/usr/bin:/bin', HOME: homedir() }, stdout: 'pipe', stderr: 'pipe' });
  return p.exitCode === 0 ? p.stdout.toString() : null;
}

export function writeLicences(servers: Map<string, ServerFile>, ladder: ReturnType<typeof buildLadder>) {
  const dir = join(CATALOG, 'LICENSES');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const kept = SOURCES.filter((s) => servers.has(s.server));
  const repos = new Map<string, Source>();
  for (const s of kept) if (!repos.has(`${s.repo}@${s.commit}`)) repos.set(`${s.repo}@${s.commit}`, s);
  for (const s of repos.values()) {
    const d = join(dir, repoSlug(s.repo));
    mkdirSync(d, { recursive: true });
    const lic = gitShow(s, s.licenceFile);
    if (!lic) throw new Error(`${s.repo}: no ${s.licenceFile} at ${s.commit}`);
    writeFileSync(join(d, s.licenceFile), lic);
    if (s.noticeFile) {
      const n = gitShow(s, s.noticeFile);
      if (!n) throw new Error(`${s.repo}: no ${s.noticeFile} at ${s.commit}`);
      writeFileSync(join(d, s.noticeFile), n);
    }
  }
  for (const s of kept) {
    if (!s.subdir) continue;
    const listed = git(s, ['ls-tree', '--name-only', s.commit, `${s.subdir}/`]) ?? '';
    for (const path of listed.split('\n').filter((p) => /^(LICEN[CS]E|NOTICE|COPYING)/i.test(p.split('/').pop() ?? ''))) {
      mkdirSync(join(dir, repoSlug(s.repo), s.subdir), { recursive: true });
      writeFileSync(join(dir, repoSlug(s.repo), path), gitShow(s, path)!);
    }
  }
  const coreBy = new Map(ladder.core.map((c) => [c.server, c]));
  const lines = [
    '# Modification notices',
    '',
    'Every file under servers/ holds tool definitions (names, descriptions, input schemas and annotations) and the initialize result that the named server returned at the named commit, captured as described in ../README.md. The definitions are reproduced unchanged. Nothing from these servers runs in our tests: a fake server built by Harness Evals replays the definitions and answers from scripted fixtures.',
    '',
    'These are the changes we made to what each server offers. They count as modifications under section 4(b) of the Apache License 2.0 and are listed here for every server, whatever its licence.',
    '',
  ];
  for (const s of kept) {
    const f = servers.get(s.server)!;
    const c = coreBy.get(s.server);
    const changes: string[] = [];
    if (c) changes.push(`Trimmed to ${c.tools.length} of its ${f.tools.length} tools in every rung (${c.tools.join(', ')}), the set a user gets with: ${c.switch}.`);
    if (f.excluded_tools.length) changes.push(`Left out of the catalog: ${f.excluded_tools.map((e) => `${e.name} (${e.reason})`).join('; ')}.`);
    changes.push(`Served under the server name \`${s.server}\` by our fake server.`);
    lines.push(`- **${s.server}** (${s.repo} at ${s.commit.slice(0, 12)}, ${s.spdx}): ${changes.join(' ')}`);
  }
  writeFileSync(join(dir, 'MODIFICATIONS.md'), `${lines.join('\n')}\n`);
}

export function survey(servers: Map<string, ServerFile>) {
  return {
    kept: SOURCES.filter((s) => servers.has(s.server)).map((s) => {
      const f = servers.get(s.server)!;
      return { server: s.server, repo: s.repo, commit: s.commit, path: f.source.path, spdx: s.spdx, licence_file: s.licenceFile, notice_file: s.noticeFile ?? null, capture_method: f.source.capture_method, job: s.job, tools: f.tools.length, tools_excluded: f.excluded_tools.length };
    }),
    not_captured: SOURCES.filter((s) => !servers.has(s.server)).map((s) => ({ server: s.server, repo: s.repo, commit: s.commit })),
    excluded: SURVEY_EXCLUDED,
  };
}

if (import.meta.main) {
  const servers = loadServers();
  const ladder = buildLadder(servers);
  writeFileSync(join(CATALOG, 'ladder.json'), `${JSON.stringify({ ...ladder, survey: survey(servers) }, null, 2)}\n`);
  writeLicences(servers, ladder);
  writeFileSync(join(CATALOG, 'README.md'), readme(servers, ladder));
  for (const r of ladder.rungs) console.log(`rung ${r.target}: ${r.size} tools on ${r.servers_count} servers`);
}
