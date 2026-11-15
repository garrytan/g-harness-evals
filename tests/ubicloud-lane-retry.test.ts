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

/** vm-shard.sh --workload frontier-harbor with stand-ins for install-check.sh, web-tools-check.ts and vm-run.sh in the
 *  checkout: the keyless smoke fails failSmoke times, writing failText to where failAt names and running onFail, then passes. */
function frontierShardHome(failSmoke: number, failText: string, failAt = 'install-check.log', onFail = '') {
  const h = temp('he-vm-frontier-retry-');
  const repo = join(h, 'work', 'harness-evals');
  const tb = join(h, 'tb-src');
  for (const d of [join(repo, 'scripts/frontier-harbor'), tb]) mkdirSync(d, { recursive: true });
  const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });
  writeFileSync(join(tb, 'README.md'), 'tb\n');
  g(tb, 'init', '-q'); g(tb, 'config', 'user.email', 't@t'); g(tb, 'config', 'user.name', 't'); g(tb, 'add', '.'); g(tb, 'commit', '-q', '-m', 'tb');
  writeFileSync(join(repo, 'scripts/frontier-harbor/pin.json'), JSON.stringify({ terminal_bench: { repo: tb, commit: g(tb, 'rev-parse', 'HEAD').trim() } }));
  writeFileSync(join(repo, 'x.json'), JSON.stringify({ shards: [{ name: 'opus-b1', cells: ['hermes-opus'] }] }));
  writeFileSync(join(repo, 'scripts/frontier-harbor/install-check.sh'), [
    'out=$1; n=$(cat "$HOME/smokes" 2>/dev/null || echo 0); echo $((n + 1)) > "$HOME/smokes"',
    '[ -e "$out/stale" ] && echo stale >> "$HOME/stale.log"',
    'mkdir -p "$out/gstack/agents/run/jobs/hermes-opus-none__a1/t1" "$out/gstack/agents/run/gstack/hermes/runtime"; touch "$out/stale"',
    'if [ "$n" -lt ' + failSmoke + ' ]; then printf "%s\\n" ' + JSON.stringify(failText) + ' > "$out/' + failAt + '"; ' + onFail + '\n echo "install check failed"; exit 1; fi',
    'exit 0',
  ].join('\n') + '\n');
  writeFileSync(join(repo, 'scripts/frontier-harbor/vm-run.sh'), 'echo "$*" >> "$HOME/driver.log"\nexit 0\n');
  g(repo, 'init', '-q'); g(repo, 'config', 'user.email', 't@t'); g(repo, 'config', 'user.name', 't'); g(repo, 'add', '.'); g(repo, 'commit', '-q', '-m', 'x');
  mkdirSync(join(h, '.bun', 'bin'), { recursive: true });
  const bun = join(h, '.bun', 'bin', 'bun');
  writeFileSync(bun, '#!/usr/bin/env bash\ncase $1 in --version) echo 1.0 ;; esac\nexit 0\n');
  chmodSync(bun, 0o755);
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh'), '--commit', g(repo, 'rev-parse', 'HEAD').trim(), '--prereg', 'x.json', '--name', 'opus-b1', '--cells', 'hermes-opus', '--lease-usd', '20', '--workload', 'frontier-harbor'],
    { cwd: h, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: h, USER: 'nobody', HE_SHARD_IN_DOCKER_GROUP: '1', HE_RETRY_BASE_S: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, out: r.stdout + r.stderr, smokes: Number(read(join(h, 'smokes')) || 0), driver: read(join(h, 'driver.log')), stale: read(join(h, 'stale.log')), shard: join(h, 'shard') };
}

describe('vm-shard.sh --workload frontier-harbor: the keyless smoke is retried only for an agent setup timeout', () => {
  const TIMEOUT = 'agents: hermes-opus-none: AgentSetupTimeoutError: Agent setup timed out after 1200.0 seconds';
  test('two agent setup timeouts (a stalled harness download) and then a pass: the counted run starts after the third smoke', () => {
    const r = frontierShardHome(2, TIMEOUT);
    expect(r.code, r.out).toBe(0);
    expect(r.smokes).toBe(3);
    expect(r.out).toContain('smoke try 2 of 4: an agent setup timed out (AgentSetupTimeoutError); next try in 0s');
    expect(r.stale).toBe('');
    expect(read(join(r.shard, 'smoke', 'try1.install-check.log'))).toContain('AgentSetupTimeoutError');
    expect(r.driver).toContain('--name opus-b1');
  }, 60_000);

  test('the timeout recorded only in a Harbor trial result.json is retried too', () => {
    const r = frontierShardHome(1, JSON.stringify({ exception_info: { exception_type: 'AgentSetupTimeoutError' } }), 'gstack/agents/run/jobs/hermes-opus-none__a1/t1/result.json');
    expect(r.code, r.out).toBe(0);
    expect(r.smokes).toBe(2);
  }, 60_000);

  test('an agent setup that never finishes: four smokes, then exit 4 and no counted run', () => {
    const r = frontierShardHome(99, TIMEOUT);
    expect(r.code, r.out).toBe(4);
    expect(r.smokes).toBe(4);
    expect(r.driver).toBe('');
  }, 60_000);

  test('a smoke failure that is not an agent setup timeout is not retried', () => {
    const r = frontierShardHome(1, 'agents: cell hermes-opus has effort flag mismatch');
    expect(r.code, r.out).toBe(4);
    expect(r.smokes).toBe(1);
    expect(r.driver).toBe('');
  }, 60_000);

  test('a timeout text only inside an installed runtime/ is not read as the smoke failing that way', () => {
    const r = frontierShardHome(1, 'AgentSetupTimeoutError', 'gstack/agents/run/gstack/hermes/runtime/notes.log');
    expect(r.code, r.out).toBe(4);
    expect(r.smokes).toBe(1);
  }, 60_000);

  for (const gate of ['egress', 'canary', 'zdr'] as const) {
    test('a timeout beside a failed ' + gate + ' check is not retried, and that report is kept', () => {
      const report = JSON.stringify({ pass: false, reasons: ['gstack: no none-baseline request for hermes', gate + ': failed'] });
      const r = frontierShardHome(1, TIMEOUT, 'install-check.log', 'printf "%s\\n" ' + JSON.stringify(report) + ' > "$out/install-check.json"');
      expect(r.code, r.out).toBe(4);
      expect(r.smokes).toBe(1);
      expect(r.driver).toBe('');
      expect(read(join(r.shard, 'smoke', 'results', 'install-check.json'))).toContain(gate + ': failed');
    }, 60_000);
  }

  const withReport = (report: object) => frontierShardHome(1, TIMEOUT, 'install-check.log', 'printf "%s\\n" ' + JSON.stringify(JSON.stringify(report)) + ' > "$out/install-check.json"');
  const noCapture = (cell: string) => 'zdr: cell ' + cell + ' no_capture: no captured Responses request';
  test('a zdr no_capture on a cell whose own trial timed out in agent setup is retried', () => {
    const r = withReport({ pass: false, agents: { vm_run_exit: 1, cells: { 'codex-sol': { exception: 'AgentSetupTimeoutError' } }, pass: false }, reasons: ['agents: cell codex-sol did not run', noCapture('codex-sol')] });
    expect(r.code, r.out).toBe(0);
    expect(r.smokes).toBe(2);
    expect(r.driver).toContain('--name opus-b1');
  }, 60_000);
  for (const [why, report] of [
    ['a zdr no_capture on a cell that did not time out', { agents: { cells: { 'codex-sol': { exception: 'AgentSetupTimeoutError' }, 'hermes-sol': { exception: null } } }, reasons: [noCapture('codex-sol'), noCapture('hermes-sol')] }],
    ['a zdr fail on the cell that timed out', { agents: { cells: { 'codex-sol': { exception: 'AgentSetupTimeoutError' } } }, reasons: ['zdr: cell codex-sol fail: store was not false'] }],
    ['the gstack arm\'s own fake-key canary in a file', { reasons: ['gstack: agents: the fake-key canary appears in run/jobs/x/agent/log.txt'] }],
    ['no gstack fake-key canary to scan for', { reasons: ['gstack: agents: no fake-key canary to scan for (canary.txt missing or empty)'] }],
    ['packets leaving the gstack skill start container', { reasons: ['gstack: skill start (hermes): 3 packet(s) left the container'] }],
    ['a gstack skill start with no packet capture', { reasons: ['gstack: skill start (codex): no packet capture was written'] }],
  ] as const) {
    test('a timeout beside ' + why + ' is not retried', () => {
      const r = withReport({ pass: false, ...report });
      expect(r.code, r.out).toBe(4);
      expect(r.smokes).toBe(1);
      expect(r.driver).toBe('');
    }, 60_000);
  }

  test('a timeout whose report fails only other checks is retried, and each try keeps its install-check.json', () => {
    const report = JSON.stringify({ pass: false, reasons: ['gstack: no none-baseline request for hermes'] });
    const r = frontierShardHome(1, TIMEOUT, 'install-check.log', 'printf "%s\\n" ' + JSON.stringify(report) + ' > "$out/install-check.json"');
    expect(r.code, r.out).toBe(0);
    expect(r.smokes).toBe(2);
    expect(read(join(r.shard, 'smoke', 'try1.install-check.json'))).toContain('no none-baseline request');
  }, 60_000);

  test.skipIf(process.getuid?.() === 0)('smoke results that cannot be cleared end the retries on that try\'s report', () => {
    const r = frontierShardHome(99, TIMEOUT, 'install-check.log', 'mkdir -p "$out/locked" && touch "$out/locked/f" && chmod 555 "$out/locked"');
    chmodSync(join(r.shard, 'smoke', 'results', 'locked'), 0o755);
    expect(r.code, r.out).toBe(4);
    expect(r.smokes).toBe(1);
    expect(r.out).toContain('smoke: could not clear smoke/results after try 1; no more tries');
    expect(r.driver).toBe('');
  }, 60_000);
});
