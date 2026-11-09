// Shared pieces of the public-safety tests: scrubbed child environments, synthetic repositories, synthetic private packs
// and runtime-built canaries. No real key, address or private string appears here; every canary is assembled from parts
// at run time so this file never matches the rules it tests.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { identityDigest, prefilter16, prefilterKey, shingleDigest } from '../scripts/public-safety/lib/pack.ts';
import { readLock, readyTool } from '../scripts/public-safety/lib/tools.ts';

export const ROOT = join(import.meta.dir, '..');
export const GATE = join(ROOT, 'scripts', 'public-safety');
export const CHECK = join(GATE, 'check.ts');
export const CACHE = join(tmpdir(), 'he-public-safety-cache');
export const NOREPLY = '1+tester@users.noreply.github.com';
export const HOME = mkdtempSync(join(tmpdir(), 'he-public-safety-home-'));

export function scrubbedEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: home, TMPDIR: tmpdir(), LANG: 'C.UTF-8', XDG_CACHE_HOME: CACHE, ...extra };
}

// gitleaks is downloaded once into the shared cache; outside CI a machine without network skips the CLI tests.
export function gitleaksReady(): boolean {
  try {
    const dest = join(tmpdir(), 'he-public-safety-bin-' + process.pid);
    readyTool('gitleaks', readLock(join(GATE, 'tools.lock')).tools.gitleaks!, { cache: join(CACHE, 'harness-evals', 'public-safety', 'tools'), dest, env: scrubbedEnv(tmpdir()) });
    rmSync(dest, { recursive: true, force: true });
    return true;
  } catch (e) {
    if (process.env.CI) throw e;
    console.warn('public-safety tests: skipped; the pinned gitleaks could not be downloaded');
    return false;
  }
}

export const rand = (n: number) => { let s = ''; while (s.length < n) s += randomBytes(n).toString('base64').replace(/[^A-Za-z0-9]/g, ''); return s.slice(0, n); };
export const keyCanary = () => 'sk-' + 'ant-api03-' + rand(32);
export const tokenCanary = () => 'ghp' + '_' + rand(36);

export type Files = Record<string, string | Buffer | null>;

export function repo(dir: string, email = NOREPLY) {
  mkdirSync(dir, { recursive: true });
  const env = scrubbedEnv(HOME);
  const g = (...a: string[]) => {
    const r = spawnSync('git', ['-C', dir, ...a], { env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git ' + a[0] + ' failed: ' + r.stderr);
    return r.stdout.trim();
  };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', email);
  g('config', 'user.name', 'Tester');
  const commit = (files: Files, message = 'change', extra: string[] = []) => {
    for (const [p, c] of Object.entries(files)) {
      if (c === null) { rmSync(join(dir, p), { force: true }); continue; }
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
    g('add', '-A');
    g(...extra, 'commit', '-q', '--allow-empty', '-m', message);
    return g('rev-parse', 'HEAD');
  };
  return { dir, g, commit, env };
}

export function check(args: string[], o: { cwd: string; home?: string; env?: Record<string, string>; input?: string; script?: string }) {
  const r = spawnSync('bun', [o.script ?? CHECK, ...args], { cwd: o.cwd, env: scrubbedEnv(o.home ?? HOME, o.env), input: o.input, encoding: 'utf8', timeout: 300_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
}

// A synthetic pack in the admission-pack/1 shape: each value contributes its full, first-16 and last-12 windows.
export function buildPack(o: { gateTree: string; values?: string[]; patterns?: { id: string; class: string; regex: string }[]; identities?: string[]; shingleText?: string; threshold?: number }) {
  const salt = randomBytes(16);
  const key = prefilterKey(salt);
  const exact = (o.values ?? []).flatMap((v) => {
    const parts: [string, string][] = [['full', v]];
    if (v.length > 16) parts.push(['head16', v.slice(0, 16)]);
    if (v.length > 12) parts.push(['tail12', v.slice(-12)]);
    return parts.map(([part, w]) => ({ name: 'SYNTHETIC', part, len: Buffer.byteLength(w), prefilter16: [prefilter16(key, Buffer.from(w))], sha256: createHash('sha256').update(salt).update(w).digest('hex') }));
  });
  const shSalt = randomBytes(16);
  const words = (o.shingleText ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const digests = [...new Set(words.slice(0, Math.max(0, words.length - 7)).map((_, i) => shingleDigest(shSalt, words.slice(i, i + 8), 16)))];
  const pack = {
    schema: 'harness-evals-admission-pack/1',
    salt: salt.toString('hex'),
    gate_tree: o.gateTree,
    exact,
    patterns: o.patterns ?? [],
    identities_blocked: (o.identities ?? []).map((e) => ({ sha256: identityDigest(salt, e) })),
    shingles: { salt: shSalt.toString('hex'), k: 8, threshold: o.threshold ?? 20, digests },
  };
  const json = JSON.stringify(pack);
  return { pack, json, sha: createHash('sha256').update(json).digest('hex') };
}

export function writePack(dir: string, p: { json: string; sha: string }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pack.json'), p.json);
  writeFileSync(join(dir, 'pack.sha256'), p.sha + '\n');
  return { pack: join(dir, 'pack.json'), pin: join(dir, 'pack.sha256') };
}
