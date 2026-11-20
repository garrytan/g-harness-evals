#!/usr/bin/env bun
// Fetches every pack the skills-at-scale ladder reads, each at its pinned commit or version, into one folder per pack:
// the skill-resolver packs (scripts/skill-resolver/packs.json) and the added packs (packs-ladder.json). Git packs are
// fetched at the pinned commit only (depth 1), so a moved branch cannot change the build; npm packs are unpacked from
// the pinned version's tarball. QM's repository is private and needs git access to yc-software/qm.
//
//   bun scripts/skills-at-scale/fetch-packs.ts --dest <dir> [--jobs 6]

import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type Source = { name: string; source: string; pin: { commit?: string; version?: string } };

const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir(), GIT_TERMINAL_PROMPT: '0' };

async function run(cmd: string[], cwd?: string): Promise<void> {
  const p = Bun.spawn(cmd, { cwd, env, stdout: 'ignore', stderr: 'pipe' });
  const code = await p.exited;
  if (code !== 0) throw new Error(cmd.slice(0, 3).join(' ') + ' exited ' + code + ': ' + (await new Response(p.stderr).text()).slice(0, 300));
}

async function fetchPack(p: Source, dest: string): Promise<string> {
  const dir = join(dest, p.name);
  if (p.pin.commit) {
    if (existsSync(join(dir, '.git'))) {
      const head = Bun.spawnSync(['git', '-C', dir, 'rev-parse', 'HEAD'], { env }).stdout.toString().trim();
      if (head === p.pin.commit) return 'kept ' + p.name;
    }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await run(['git', 'init', '-q'], dir);
    await run(['git', 'remote', 'add', 'origin', p.source], dir);
    await run(['git', 'fetch', '-q', '--depth', '1', 'origin', p.pin.commit], dir);
    await run(['git', '-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD'], dir);
    return 'fetched ' + p.name + ' ' + p.pin.commit;
  }
  const pkg = p.source.replace(/^npm:/, '');
  if (existsSync(join(dir, 'package.json')) && (await Bun.file(join(dir, 'package.json')).json()).version === p.pin.version) return 'kept ' + p.name;
  const tmp = mkdtempSync(join(tmpdir(), 'pack-'));
  try {
    await run(['npm', 'pack', '-q', pkg + '@' + p.pin.version], tmp);
    await run(['tar', 'xzf', pkg + '-' + p.pin.version + '.tgz'], tmp);
    rmSync(dir, { recursive: true, force: true });
    renameSync(join(tmp, 'package'), dir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return 'fetched ' + p.name + ' ' + pkg + '@' + p.pin.version;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const val = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const dest = val('--dest');
  if (!dest) { console.error('usage: fetch-packs.ts --dest <dir> [--jobs 6]'); process.exit(2); }
  const repo = resolve(import.meta.dir, '..', '..');
  const ladder = await Bun.file(join(import.meta.dir, 'packs-ladder.json')).json();
  const core = (await Bun.file(join(repo, ladder.core.packs_file)).json()).packs as Source[];
  const queue: Source[] = [...core, ...(ladder.added as Source[])];
  mkdirSync(dest, { recursive: true });
  let failed = 0;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try { console.log(await fetchPack(p, dest)); } catch (e) { failed++; console.error('FETCH_FAIL ' + p.name + ' ' + (e as Error).message); }
    }
  };
  await Promise.all(Array.from({ length: Number(val('--jobs') ?? 6) }, worker));
  process.exit(failed ? 1 : 0);
}
