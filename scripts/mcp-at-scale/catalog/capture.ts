#!/usr/bin/env bun
// Captures each catalog server's initialize result and tools/list at its pinned commit, sandboxed (internal-task plan,
// "The catalog and its source"). For every runtime source in sources.ts:
//
//   1. The source tree at the pinned commit is exported with git archive on the host (nothing in it runs on the host).
//   2. An install container is created on an internal docker network whose only way out is egress-proxy.mjs, which lets
//      through the package registries in REGISTRY_ALLOWLIST and logs every request. The tree is copied in with docker cp
//      (no volume mount), and the install runs with lifecycle scripts off where the package manager allows.
//   3. The installed container is committed to a throwaway image, and the server is started from it with --network none,
//      no volume mount, and only the environment in the source's runEnv (placeholders, never a real credential).
//   4. The host speaks MCP over the container's stdio: initialize, notifications/initialized, then tools/list until
//      there is no nextCursor. When the source names a core filter, the server is started a second time with that
//      switch and the filtered tool names are recorded too.
//
// The host side runs docker under env -i with PATH and HOME only. Output: tasks/mcp-at-scale/catalog/servers/<server>.json,
// plus capture logs and source caches under --work (default ~/.cache/harness-evals/mcp-catalog, never committed).
//
//   bun scripts/mcp-at-scale/catalog/capture.ts [--only a,b] [--work <dir>] [--keep-images]
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { SOURCES, REGISTRY_ALLOWLIST, DEFAULT_WORK, type Source, type RuntimeSource } from './sources.ts';

const ROOT = resolve(import.meta.dir, '../../..');
export const SERVERS_DIR = join(ROOT, 'tasks/mcp-at-scale/catalog/servers');
const NET = 'mcpcat-internal';
const PROXY = 'mcpcat-proxy';
const PROTOCOL = '2025-06-18';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const only = flag('--only')?.split(',');
const work = resolve(flag('--work') ?? DEFAULT_WORK);
const keepImages = args.includes('--keep-images');
mkdirSync(work, { recursive: true });
mkdirSync(SERVERS_DIR, { recursive: true });

const hostEnv = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: homedir() };

function sh(cmd: string[], opts: { input?: string; allowFail?: boolean; log?: string } = {}) {
  const p = Bun.spawnSync(cmd, { env: hostEnv, stdin: opts.input ? Buffer.from(opts.input) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const out = p.stdout.toString();
  const err = p.stderr.toString();
  if (opts.log) appendFileSync(opts.log, `$ ${cmd.join(' ')}\n${out}${err}\n`);
  if (p.exitCode !== 0 && !opts.allowFail) throw new Error(`${cmd.slice(0, 4).join(' ')} exited ${p.exitCode}: ${err.slice(-2000)}`);
  return { code: p.exitCode, out, err };
}

function ensureNetwork() {
  if (sh(['docker', 'network', 'inspect', NET], { allowFail: true }).code !== 0) sh(['docker', 'network', 'create', '--internal', NET]);
  const running = sh(['docker', 'ps', '-q', '-f', `name=^${PROXY}$`]).out.trim();
  if (running) return;
  sh(['docker', 'rm', '-f', PROXY], { allowFail: true });
  sh(['docker', 'create', '--name', PROXY, '--network', 'bridge', 'node:22-bookworm-slim', 'node', '/proxy.mjs', '3128', REGISTRY_ALLOWLIST.join(',')]);
  sh(['docker', 'cp', join(import.meta.dir, 'egress-proxy.mjs'), `${PROXY}:/proxy.mjs`]);
  sh(['docker', 'network', 'connect', NET, PROXY]);
  sh(['docker', 'start', PROXY]);
}

function sourceTar(s: Source, log: string): string {
  const repoDir = join(work, 'src', s.repo.replace('/', '_'));
  if (!existsSync(join(repoDir, '.git'))) {
    mkdirSync(repoDir, { recursive: true });
    sh(['git', '-C', repoDir, 'init', '-q'], { log });
    sh(['git', '-C', repoDir, 'remote', 'add', 'origin', `https://github.com/${s.repo}`], { log });
  }
  const have = sh(['git', '-C', repoDir, 'cat-file', '-e', `${s.commit}^{commit}`], { allowFail: true }).code === 0;
  if (!have) sh(['git', '-C', repoDir, 'fetch', '-q', '--depth', '1', 'origin', s.commit], { log });
  const tar = join(work, 'tar', `${s.repo.replace('/', '_')}-${s.commit.slice(0, 12)}.tar`);
  mkdirSync(join(work, 'tar'), { recursive: true });
  if (!existsSync(tar)) sh(['git', '-C', repoDir, 'archive', '--format=tar', '--prefix=src/', '-o', tar, s.commit], { log });
  return tar;
}

const imageTag = (s: RuntimeSource) => `mcpcat/${s.buildGroup ?? s.server}:${s.commit.slice(0, 12)}`;
const builtTags = new Set<string>();

function buildImage(s: RuntimeSource, log: string): string {
  const tag = imageTag(s);
  builtTags.add(tag);
  if (sh(['docker', 'image', 'inspect', tag], { allowFail: true }).code === 0) return tag;
  const tar = sourceTar(s, log);
  const name = `mcpcat-install-${s.buildGroup ?? s.server}`;
  sh(['docker', 'rm', '-f', name], { allowFail: true });
  sh(['docker', 'pull', '-q', s.image], { log });
  const script = [
    'set -eu',
    `export HTTP_PROXY=http://${PROXY}:3128 HTTPS_PROXY=http://${PROXY}:3128 http_proxy=http://${PROXY}:3128 https_proxy=http://${PROXY}:3128`,
    'export npm_config_ignore_scripts=true npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false',
    'mkdir -p /src && tar -xf /tmp/src.tar -C / && rm /tmp/src.tar',
    `cd /src/${s.buildGroup ? '' : (s.subdir ?? '')}`,
    s.install,
  ].join('\n');
  sh(['docker', 'create', '--name', name, '--network', NET, '-w', '/src', '--env', 'HOME=/root', s.image, 'sh', '-c', script], { log });
  sh(['docker', 'cp', tar, `${name}:/tmp/src.tar`], { log });
  const r = sh(['docker', 'start', '-a', name], { log, allowFail: true });
  if (r.code !== 0) { sh(['docker', 'rm', '-f', name], { allowFail: true }); throw new Error(`install failed for ${s.server}, see ${log}`); }
  sh(['docker', 'commit', '--change', 'CMD []', '--change', 'ENTRYPOINT []', name, tag], { log });
  sh(['docker', 'rm', '-f', name], { allowFail: true });
  return tag;
}

type Rpc = { id?: number; result?: any; error?: any; method?: string };

let runCounter = 0;

async function mcpSession(tag: string, s: RuntimeSource, extraArgs: string[], log: string) {
  const envArgs = Object.entries(s.runEnv ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  const runName = `mcpcat-run-${s.server}-${++runCounter}`;
  const cmd = ['docker', 'run', '--rm', '-i', '--init', '--name', runName, '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', '4g', '-w', `/src/${s.workdir ?? s.subdir ?? ''}`, ...envArgs, tag, ...s.run, ...extraArgs];
  appendFileSync(log, `$ ${cmd.join(' ')}\n`);
  const p = Bun.spawn(cmd, { env: hostEnv, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const pending = new Map<number, (m: Rpc) => void>();
  const noise: string[] = [];
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    const reader = p.stdout.getReader();
    for (;;) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      buf += dec.decode(chunk);
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let m: Rpc;
        try { m = JSON.parse(line); } catch { noise.push(line.slice(0, 300)); continue; }
        if (typeof m.id === 'number' && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
      }
    }
  })();
  (async () => {
    const reader = p.stderr.getReader();
    for (;;) { const { value, done } = await reader.read(); if (done) break; appendFileSync(log, value); }
  })();
  let next = 1;
  const send = (o: object) => { p.stdin.write(`${JSON.stringify(o)}\n`); p.stdin.flush(); };
  const call = (method: string, params: object, timeoutMs = 120_000) => new Promise<any>((res, rej) => {
    const id = next++;
    const timer = setTimeout(() => rej(new Error(`${method} timed out`)), timeoutMs);
    pending.set(id, (m) => { clearTimeout(timer); m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result); });
    send({ jsonrpc: '2.0', id, method, params });
  });
  try {
    const init = await call('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'harness-evals-catalog-capture', version: '1' } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const tools: any[] = [];
    let cursor: string | undefined;
    do {
      const r = await call('tools/list', cursor ? { cursor } : {});
      tools.push(...(r.tools ?? []));
      cursor = r.nextCursor;
    } while (cursor);
    if (noise.length) appendFileSync(log, `non-JSON stdout lines: ${noise.length}\n`);
    return { init, tools };
  } finally {
    sh(['docker', 'rm', '-f', runName], { allowFail: true });
    p.kill();
    await p.exited;
  }
}

export function toolRecord(t: any) {
  return { name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? { type: 'object' }, annotations: t.annotations ?? {} };
}

export function writeServer(s: Source, body: { initialize: any; tools: any[]; capture: object; core_filter?: object }) {
  const exclude = new Map((s.excludeTools ?? []).map((e) => [e.name, e.reason]));
  const kept = body.tools.filter((t) => !exclude.has(t.name)).map(toolRecord);
  const excluded = body.tools.filter((t) => exclude.has(t.name)).map((t) => ({ name: t.name, reason: exclude.get(t.name)! }));
  const missing = [...exclude.keys()].filter((n) => !body.tools.some((t) => t.name === n));
  if (missing.length) throw new Error(`${s.server}: excludeTools names not in tools/list: ${missing.join(', ')}`);
  const init = body.initialize ?? {};
  const out = {
    server: s.server,
    source: { repo: s.repo, commit: s.commit, path: s.subdir ?? s.workdir ?? '', spdx: s.spdx, licence_file: s.licenceFile, notice_file: s.noticeFile ?? null, capture_method: s.staticVia ? 'static' : 'runtime' },
    job: s.job,
    capture: body.capture,
    initialize: { protocolVersion: init.protocolVersion ?? null, capabilities: init.capabilities ?? {}, serverInfo: init.serverInfo ?? {}, instructions: init.instructions ?? null },
    tools: kept,
    excluded_tools: excluded,
    ...(body.core_filter ? { core_filter: body.core_filter } : {}),
  };
  writeFileSync(join(SERVERS_DIR, `${s.server}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

async function captureRuntime(s: RuntimeSource) {
  const log = join(work, 'logs', `${s.server}.log`);
  mkdirSync(join(work, 'logs'), { recursive: true });
  writeFileSync(log, '');
  const tag = buildImage(s, log);
  const digest = sh(['docker', 'image', 'inspect', '--format', '{{index .RepoDigests 0}}', s.image], { allowFail: true }).out.trim();
  const full = await mcpSession(tag, { ...s, runEnv: { ...s.runEnv, ...s.fullEnv } }, s.fullArgs ?? [], log);
  let core_filter;
  if (s.coreFilter) {
    const f = await mcpSession(tag, { ...s, runEnv: { ...s.runEnv, ...s.coreFilter.env } }, s.coreFilter.args ?? [], log);
    core_filter = { switch: s.coreFilter.switch, args: s.coreFilter.args ?? [], env: s.coreFilter.env ?? {}, tools: f.tools.map((t: any) => t.name) };
  }
  const out = writeServer(s, {
    initialize: full.init,
    tools: full.tools,
    capture: { ...(s.staticVia ? { static_via: s.staticVia } : {}), base_image: digest || s.image, install: s.install, run: [...s.run, ...(s.fullArgs ?? [])], ...(s.fullEnv ? { listing_env: s.fullEnv } : {}), placeholder_env: Object.keys(s.runEnv ?? {}), network_while_running: 'none', protocol_version_requested: PROTOCOL },
    core_filter,
  });
  return out;
}

if (import.meta.main) {
  ensureNetwork();
  const failures: string[] = [];
  for (const s of SOURCES) {
    if (only && !only.includes(s.server)) continue;
    try {
      const out = await captureRuntime(s);
      console.log(`${s.server}: ${out.tools.length} tools (${out.excluded_tools.length} excluded)${'core_filter' in out && out.core_filter ? `, core filter ${(out.core_filter as any).tools.length}` : ''}`);
    } catch (e) {
      failures.push(s.server);
      console.error(`${s.server}: FAILED ${(e as Error).message.slice(0, 500)}`);
    }
  }
  if (!keepImages) for (const tag of builtTags) sh(['docker', 'rmi', '-f', tag], { allowFail: true });
  sh(['docker', 'logs', PROXY], { log: join(work, 'logs', 'egress-proxy.log'), allowFail: true });
  if (failures.length) { console.error(`failed: ${failures.join(', ')}`); process.exit(1); }
}
