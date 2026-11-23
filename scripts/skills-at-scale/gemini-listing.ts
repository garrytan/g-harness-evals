#!/usr/bin/env bun
// Gemini CLI's skill listing, keyless (internal-task-a, internal-task-b, plan decision E). Gemini CLI has no adapter in this repository and
// no gbrain installer, so this is the smallest harness that shows what it sends: the real CLI from npm in a container, the
// catalog in ~/.gemini/skills, one prompt with -p, and its model requests answered by the frontier Harbor fake upstream
// (scripts/frontier-harbor/fake-upstream.ts reply(), its Gemini generateContent route) on the loopback. Nothing leaves the machine
// and the key is a placeholder.
//
//   bun scripts/skills-at-scale/gemini-listing.ts --catalog <rung dir> --out <dir> [--version 0.69.0] [--prompt <text>]
//
// Settings are the ones a user writes for API-key auth (security.auth.selectedType gemini-api-key), usage statistics off, and
// experimental.skills true (as Harbor 0.24.0's GeminiCli class writes it); settings.json is kept in <out>. Writes
// <out>/requests.json (every request body) and <out>/cli.log, and returns them.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { reply } from '../frontier-harbor/fake-upstream.ts';

export const GEMINI_CLI_VERSION = '0.69.0';
export const GEMINI_SETTINGS = { security: { auth: { selectedType: 'gemini-api-key' } }, privacy: { usageStatisticsEnabled: false }, experimental: { skills: true } };
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };

export function geminiImage(version = GEMINI_CLI_VERSION): string {
  const tag = 'harness-eval/gemini-cli:sas-' + version;
  if (spawnSync('docker', ['image', 'inspect', tag], { env: ENV }).status === 0) return tag;
  const r = spawnSync('docker', ['build', '-q', '-t', tag, '-'], { input: 'FROM node:24-bookworm-slim\nRUN npm install -g @google/gemini-cli@' + version + ' && gemini --version\n', encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error('docker build ' + tag + ' failed: ' + (r.stderr ?? '').slice(-600));
  return tag;
}

export type GeminiCapture = { requests: { path: string; body: Record<string, any> }[]; version: string; exit: number | null; log: string };

export async function geminiListing(o: { catalog: string; out: string; version?: string; prompt?: string }): Promise<GeminiCapture> {
  const version = o.version ?? GEMINI_CLI_VERSION;
  const image = geminiImage(version);
  rmSync(o.out, { recursive: true, force: true });
  const home = join(o.out, 'home');
  mkdirSync(join(home, '.gemini'), { recursive: true });
  mkdirSync(join(o.out, 'work'), { recursive: true });
  cpSync(join(o.catalog, 'skills'), join(home, '.gemini', 'skills'), { recursive: true });
  writeFileSync(join(home, '.gemini', 'settings.json'), JSON.stringify(GEMINI_SETTINGS, null, 2));
  writeFileSync(join(o.out, 'settings.json'), JSON.stringify(GEMINI_SETTINGS, null, 2));
  const requests: GeminiCapture['requests'] = [];
  let n = 0;
  const fake = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (req) => {
    const path = new URL(req.url).pathname;
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, any>) : {};
    requests.push({ path, body });
    return reply(path, body, ++n);
  } });
  try {
    const uid = String(process.getuid?.() ?? 0) + ':' + String(process.getgid?.() ?? 0);
    const r = await new Promise<{ status: number | null; out: string }>((done) => {
      const p = Bun.spawn(['docker', 'run', '--rm', '--network', 'host', '--user', uid, '-v', home + ':/home/gem', '-v', join(o.out, 'work') + ':/work', '-w', '/work',
        '-e', 'HOME=/home/gem', '-e', 'GEMINI_API_KEY=placeholder-not-a-key', '-e', 'GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:' + fake.port + '/google', '-e', 'GEMINI_CLI_TRUST_WORKSPACE=true',
        image, 'timeout', '240', 'gemini', '-m', 'gemini-4-carbon', '--yolo', '-p', o.prompt ?? 'Write the hiring report for this week.'], { env: ENV, stdout: 'pipe', stderr: 'pipe' });
      Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([a, b, s]) => done({ status: s, out: a + b }));
    });
    writeFileSync(join(o.out, 'cli.log'), r.out);
    writeFileSync(join(o.out, 'requests.json'), JSON.stringify(requests, null, 1));
    return { requests, version, exit: r.status, log: r.out };
  } finally { fake.stop(true); }
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  if (!v('--catalog') || !v('--out')) { console.error('usage: gemini-listing.ts --catalog <rung dir> --out <dir> [--version x] [--prompt text]'); process.exit(2); }
  const c = await geminiListing({ catalog: resolve(v('--catalog')!), out: resolve(v('--out')!), version: v('--version'), prompt: v('--prompt') });
  console.log('GEMINI ' + c.version + ' exit=' + c.exit + ' requests=' + c.requests.length + ' paths=' + [...new Set(c.requests.map((r) => r.path))].join(','));
  if (!existsSync(join(resolve(v('--out')!), 'requests.json'))) process.exit(1);
}
