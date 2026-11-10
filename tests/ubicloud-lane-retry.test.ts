// internal-task Amendment 3 part 3 addendum: the Ubicloud lane retries the network steps a GitHub outage breaks, without
// changing anything a trial sees. bootstrap.sh installs Bun with retries and backoff, falls back to the npm registry's
// @oven/bun-linux-<arch> package checked against its sha512 integrity, and fails closed unless bun --version is ci.yml's
// pin; vm-shard.sh retries the qm-driver smoke (which builds the images) only when an image build failed; the QM core
// Dockerfile's npm ci steps carry npm's own fetch retries and keep the lockfile in charge of every byte.
//
// Value: protects=a shard survives a run of GitHub 504s (2026-11-08, six failed canary launches) and still installs
// exactly Bun 1.4.3 and the lockfile's packages; fails_when=a 504 ends the bootstrap or the smoke at once, an endless 504
// does not fail closed, a tarball whose integrity does not match or a wrong Bun version is accepted, the smoke is retried
// for a failure that is not an image build, or the Dockerfile loosens the lockfile; seam=local stub servers for the Bun
// install script and the npm registry, HE_BOOTSTRAP_ONLY=bun, and a fake bun in vm-shard.sh's PATH; no_claim=a real VM.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const LEDGER_CLI = join(ROOT, 'runner', 'ledger', 'budget-ledger.ts');
const dirs: string[] = [];
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => { for (const s of servers) s.stop(true); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const temp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const ARCH = process.arch === 'arm64' ? 'aarch64' : 'x64';
const fakeBun = (version: string) => '#!/usr/bin/env bash\n[ "$1" = --version ] && echo ' + version + '\nexit 0\n';

/** A tarball laid out as the npm package is: package/bin/bun. */
function bunTarball(version: string): Buffer {
  const d = temp('he-bun-tgz-');
  mkdirSync(join(d, 'package', 'bin'), { recursive: true });
  writeFileSync(join(d, 'package', 'bin', 'bun'), fakeBun(version));
  chmodSync(join(d, 'package', 'bin', 'bun'), 0o755);
  execFileSync('tar', ['-czf', join(d, 'bun.tgz'), '-C', d, 'package']);
  return readFileSync(join(d, 'bun.tgz'));
}

/** Stub upstreams: /install answers 504 installFail times (Infinity: always) and then a script that writes a bun printing
 *  installVersion; the registry answers 504 registryFail times and then metadata and a tarball, whose integrity can be
 *  wrong on purpose. */
function stubs(o: { installFail: number; installVersion?: string; installNoop?: boolean; registryFail?: number; tarballVersion?: string; badIntegrity?: boolean }) {
  let installFails = o.installFail, registryFails = o.registryFail ?? 0;
  const hits = { install: 0, meta: 0, tarball: 0 };
  const tgz = bunTarball(o.tarballVersion ?? '1.4.3');
  const integrity = 'sha512-' + createHash('sha512').update(o.badIntegrity ? Buffer.from('other bytes') : tgz).digest('base64');
  const server: ReturnType<typeof Bun.serve> = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req): Response {
    const path = new URL(req.url).pathname;
    const base: string = 'http://127.0.0.1:' + server.port;
    if (path === '/install') {
      hits.install++;
      if (installFails-- > 0) return new Response('504 Gateway Time-out', { status: 504 });
      if (o.installNoop) return new Response('exit 0\n');
      return new Response('mkdir -p "$BUN_INSTALL/bin"\ncat > "$BUN_INSTALL/bin/bun" <<' + "'EOF'" + '\n' + fakeBun(o.installVersion ?? '1.4.3') + 'EOF\nchmod +x "$BUN_INSTALL/bin/bun"\n');
    }
    if (path === '/registry/@oven/bun-linux-' + ARCH + '/1.4.3') {
      hits.meta++;
      if (registryFails-- > 0) return new Response('504', { status: 504 });
      return Response.json({ name: '@oven/bun-linux-' + ARCH, version: '1.4.3', dist: { tarball: base + '/tarball/bun.tgz', integrity } });
    }
    if (path === '/tarball/bun.tgz') { hits.tarball++; return new Response(new Uint8Array(tgz)); }
    return new Response('not found', { status: 404 });
  } });
  servers.push(server);
  return { url: 'http://127.0.0.1:' + server.port, hits };
}

/** Async: the stubs run in this process, so a synchronous spawn would block them. */
async function bootstrapBun(s: { url: string }, staleVersion?: string) {
  const h = temp('he-bootstrap-');
  if (staleVersion) {
    mkdirSync(join(h, '.bun', 'bin'), { recursive: true });
    writeFileSync(join(h, '.bun', 'bin', 'bun'), fakeBun(staleVersion));
    chmodSync(join(h, '.bun', 'bin', 'bun'), 0o755);
  }
  mkdirSync(join(h, 'repo', '.github', 'workflows'), { recursive: true });
  writeFileSync(join(h, 'repo', '.github', 'workflows', 'ci.yml'), 'jobs:\n  t:\n    steps:\n      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: 1.4.3\n');
  const p = Bun.spawn(['bash', join(ROOT, 'scripts', 'ubicloud', 'bootstrap.sh')], { cwd: join(h, 'repo'), stdout: 'pipe', stderr: 'pipe',
    env: { PATH: '/usr/bin:/bin', HOME: h, HE_BOOTSTRAP_ONLY: 'bun', HE_RETRY_BASE_S: '0', HE_BUN_INSTALL_URL: s.url + '/install', HE_BUN_NPM_REGISTRY: s.url + '/registry' } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out + err, bun: read(join(h, '.bun', 'bin', 'bun')), home: h };
}

describe('bootstrap.sh: Bun with retries, an npm-registry fallback and a fail-closed version check', async () => {
  test('the install script 504s three times and then works: Bun 1.4.3 after four tries', async () => {
    const s = stubs({ installFail: 3 });
    const r = await bootstrapBun(s);
    expect(r.code, r.out).toBe(0);
    expect(s.hits.install).toBe(4);
    expect(s.hits.meta).toBe(0);
    expect(r.out).toContain('bun install try 3 of 6 failed');
    expect(r.bun).toContain('echo 1.4.3');
  }, 60_000);

  test('the install script 504s every time: six tries, then the npm package, checked against its integrity', async () => {
    const s = stubs({ installFail: Infinity, registryFail: 2 });
    const r = await bootstrapBun(s);
    expect(r.code, r.out).toBe(0);
    expect(s.hits.install).toBe(6);
    expect(s.hits.meta).toBe(3);
    expect(s.hits.tarball).toBe(1);
    expect(r.out).toContain('npm registry package @oven/bun-linux-' + ARCH + '@1.4.3');
    expect(r.bun).toContain('echo 1.4.3');
  }, 60_000);

  test('GitHub and the registry both 504 forever: the bootstrap fails closed with no bun installed', async () => {
    const s = stubs({ installFail: Infinity, registryFail: Infinity });
    const r = await bootstrapBun(s);
    expect(r.code, r.out).not.toBe(0);
    expect(s.hits.install).toBe(6);
    expect(s.hits.meta).toBe(6);
    expect(r.bun).toBe('');
  }, 60_000);

  test('a registry tarball whose sha512 does not match its integrity is refused', async () => {
    const s = stubs({ installFail: Infinity, badIntegrity: true });
    const r = await bootstrapBun(s);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('integrity');
    expect(r.bun).toBe('');
  }, 60_000);

  test('a Bun that is not ci.yml\'s version fails closed, from either source', async () => {
    const a = await bootstrapBun(stubs({ installFail: 0, installVersion: '1.4.2' }));
    expect(a.code, a.out).not.toBe(0);
    expect(a.out).toContain('ci.yml pins 1.4.3');
    const b = await bootstrapBun(stubs({ installFail: Infinity, tarballVersion: '1.4.2' }));
    expect(b.code, b.out).not.toBe(0);
    expect(b.out).toContain('ci.yml pins 1.4.3');
  }, 60_000);

  test('the npm fallback leaves bunx linked to the same Bun, as the install script does', async () => {
    const s = stubs({ installFail: Infinity });
    const r = await bootstrapBun(s);
    expect(r.code, r.out).toBe(0);
    expect(s.hits.tarball).toBe(1);
    const bunx = join(r.home, '.bun', 'bin', 'bunx');
    expect(readlinkSync(bunx)).toBe('bun');
    expect(execFileSync(bunx, ['--version'], { encoding: 'utf8' }).trim()).toBe('1.4.3');
  }, 60_000);

  test('a stale Bun of another version is replaced through the retries and the npm package, not accepted', async () => {
    const s = stubs({ installFail: 0, installNoop: true });
    const r = await bootstrapBun(s, '1.0.0');
    expect(r.code, r.out).toBe(0);
    expect(s.hits.install).toBe(6);
    expect(s.hits.tarball).toBe(1);
    expect(r.bun).toContain('echo 1.4.3');
  }, 60_000);
});

/** vm-shard.sh with a fake bun whose keyless smoke fails failSmoke times with failText, then passes. */
function shardHome(failSmoke: number, failText: string) {
  const h = temp('he-vm-retry-');
  const repo = join(h, 'work', 'harness-evals');
  mkdirSync(repo, { recursive: true });
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  writeFileSync(join(repo, 'README.md'), 'x\n');
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'x');
  mkdirSync(join(h, '.bun', 'bin'), { recursive: true });
  const bun = join(h, '.bun', 'bin', 'bun');
  writeFileSync(bun, [
    '#!/usr/bin/env bash',
    'case $1 in',
    '  --version) echo 1.0 ;;',
    '  runner/ledger/budget-ledger.ts) shift; exec ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(LEDGER_CLI) + ' "$@" ;;',
    '  -e) exec ' + JSON.stringify(process.execPath) + ' "$@" ;;',
    '  harnesses/qm/gstack/s1e-probe.ts)',
    '    if [ "$2" = --dry-run ]; then n=$(cat "$HOME/smokes" 2>/dev/null || echo 0); echo $((n + 1)) > "$HOME/smokes"',
    '      [ "$n" -lt ' + failSmoke + ' ] && { echo ' + JSON.stringify(failText) + '; exit 1; }; exit 0; fi',
    '    echo "$*" >> "$HOME/driver.log" ;;',
    'esac',
    'exit 0',
  ].join('\n') + '\n');
  chmodSync(bun, 0o755);
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh'), '--commit', g('rev-parse', 'HEAD').trim(), '--prereg', 'x.json', '--name', 'opus-b1', '--cells', 'opus.b1', '--lease-usd', '61.25', '--workload', 'qm-driver', '--', '--stage', 'headroom', '--shards', '8', '--run-id', 'qm-s1-edition-2026-11-headroom'],
    { cwd: h, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: h, USER: 'nobody', HE_SHARD_IN_DOCKER_GROUP: '1', HE_RETRY_BASE_S: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, out: r.stdout + r.stderr, smokes: Number(read(join(h, 'smokes')) || 0), driver: read(join(h, 'driver.log')) };
}

describe('vm-shard.sh --workload qm-driver: the smoke is retried only for an image build failure', () => {
  test('two image-build failures (an npm 504) and then a pass: the counted run starts after the third smoke', () => {
    const r = shardHome(2, 'error: s1e: image build core failed (/home/ubi/shard/smoke/work/build-core.log)');
    expect(r.code, r.out).toBe(0);
    expect(r.smokes).toBe(3);
    expect(r.out).toContain('smoke try 2 of 4: an image build failed');
    expect(r.driver).toContain('--run-id qm-s1-edition-2026-11-headroom');
  }, 60_000);

  test('an image build that never succeeds: four smokes, then exit 4 and no counted run', () => {
    const r = shardHome(99, 'error: s1e: image build core failed (x)');
    expect(r.code, r.out).toBe(4);
    expect(r.smokes).toBe(4);
    expect(r.driver).toBe('');
  }, 60_000);

  test('a smoke failure that is not an image build is not retried', () => {
    const r = shardHome(1, 's1e: dry-run checks {"contaminated":false}');
    expect(r.code, r.out).toBe(4);
    expect(r.smokes).toBe(1);
    expect(r.driver).toBe('');
  }, 60_000);
});

describe('harnesses/qm/Dockerfile: npm fetch retries, the lockfile still decides the bytes', () => {
  const lines = readFileSync(join(ROOT, 'harnesses', 'qm', 'Dockerfile'), 'utf8').split('\n').filter((l) => /\bnpm (ci|install)\b/.test(l));
  test('every npm step is npm ci with fetch-retries 6 and longer backoff', () => {
    expect(lines.length).toBe(3);
    for (const l of lines) {
      expect(l).toMatch(/\bnpm ci\b/);
      expect(l).toContain('--fetch-retries=6');
      expect(l).toContain('--fetch-retry-mintimeout=20000');
      expect(l).toContain('--fetch-retry-maxtimeout=120000');
      expect(l).not.toMatch(/--no-package-lock|--package-lock=false|npm install|--force|--legacy-peer-deps|integrity/);
    }
  });
});
