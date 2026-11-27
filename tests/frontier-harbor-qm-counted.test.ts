// QM cells on the counted Ubicloud path (internal-task): a shard of QM cells takes QM's own keyless check
// (scripts/frontier-harbor/qm-install-check.sh) as its smoke and as its --install-check lane, since install-check.sh runs no
// QM cell and the web-tools check and the zero-data-retention gate would find no QM slot in its captures; a shard that mixes
// QM cells with another harness's is refused; and run-shard.sh's --zdr-gate reads a QM check's install-check-qm.json.
// Keyless: vm-shard.sh runs against a scratch checkout whose check scripts, vm-run.sh and bun only record their arguments.
//
// Value: protects=a QM shard's smoke and install check run qm-install-check.sh, other shards keep install-check.sh, a mixed
// shard stops before any check, and a QM gate directory passes the ZDR gate's commit check; fails_when=a counted QM shard
// smokes with install-check.sh (no QM bind, so web-tools and ZDR fail) or a QM gate is refused as naming no commit;
// seam=a scratch ~/work checkout and a PATH-first bun; no_claim=a real VM, Harbor or QM run.

import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const temp = (p: string) => { const d = realpathSync(mkdtempSync(join(tmpdir(), p))); dirs.push(d); return d; };
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
type Cell = { id: string; harness: string; model: string };
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
const init = (cwd: string) => { git(cwd, 'init', '-q'); git(cwd, 'config', 'user.email', 't@t'); git(cwd, 'config', 'user.name', 't'); git(cwd, 'add', '.'); git(cwd, 'commit', '-q', '-m', 'x'); return git(cwd, 'rev-parse', 'HEAD'); };

/** vm-shard.sh --workload frontier-harbor on a scratch checkout; every check script, vm-run.sh and bun record their calls. */
function vmShard(cells: Cell[], args: string[] = []) {
  const h = temp('he-qm-shard-');
  const tb = join(h, 'terminal-bench-2-1');
  mkdirSync(tb);
  writeFileSync(join(tb, 'README.md'), 'tb\n');
  const tbCommit = init(tb);
  const repo = join(h, 'work', 'harness-evals');
  mkdirSync(join(repo, 'scripts', 'frontier-harbor'), { recursive: true });
  writeFileSync(join(repo, 'scripts', 'frontier-harbor', 'pin.json'), JSON.stringify({ terminal_bench: { repo: tb, commit: tbCommit } }));
  for (const f of ['install-check.sh', 'qm-install-check.sh', 'vm-run.sh']) writeFileSync(join(repo, 'scripts', 'frontier-harbor', f), 'echo "' + f + ' $*" >> "$HOME/calls.log"\n');
  writeFileSync(join(repo, 'prereg.json'), JSON.stringify({ run_id: 'qm-shard-test', cells, shards: [{ name: 's1', cells: cells.map((c) => c.id) }] }));
  const commit = init(repo);
  mkdirSync(join(h, '.bun', 'bin'), { recursive: true });
  writeFileSync(join(h, '.bun', 'bin', 'bun'), '#!/usr/bin/env bash\ncase $1 in --version) echo 1.0 ;; install) ;; *) echo "bun $*" >> "$HOME/calls.log" ;; esac\nexit 0\n');
  chmodSync(join(h, '.bun', 'bin', 'bun'), 0o755);
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh'), '--commit', commit, '--prereg', 'prereg.json', '--name', 's1', '--cells', cells.map((c) => c.id).join(','), '--lease-usd', '10', '--workload', 'frontier-harbor', ...args],
    { cwd: h, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: h, USER: 'nobody', HE_SHARD_IN_DOCKER_GROUP: '1', HE_RETRY_BASE_S: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, out: r.stdout + r.stderr, calls: read(join(h, 'calls.log')).split('\n').filter(Boolean), home: h };
}

const qmCarbon: Cell = { id: 'qm-carbon', harness: 'qm', model: 'openrouter:google/gemini-4-carbon' };
const qmSol: Cell = { id: 'qm-sol', harness: 'qm', model: 'openai:gpt-6.2-sol' };
const piOpus: Cell = { id: 'pi-opus', harness: 'pi', model: 'anthropic:claude-opus-5-5' };

describe('vm-shard.sh: a shard of QM cells smokes with QM\'s own keyless check', () => {
  test('QM cells: the smoke is qm-install-check.sh, then the web-tools check reads its results, then the counted run', () => {
    const r = vmShard([qmCarbon, qmSol]);
    expect(r.code, r.out).toBe(0);
    const smoke = join(r.home, 'shard', 'smoke', 'results');
    expect(r.calls[0]).toBe('qm-install-check.sh ' + smoke);
    expect(r.calls[1]).toStartWith('bun scripts/frontier-harbor/web-tools-check.ts --smoke ' + smoke + ' --prereg prereg.json --name s1');
    expect(r.calls[2]).toStartWith('vm-run.sh --prereg prereg.json --name s1 --lease-usd 10');
    expect(r.calls.some((c) => c.startsWith('install-check.sh'))).toBe(false);
  }, 60_000);

  test('other harnesses keep install-check.sh', () => {
    const r = vmShard([piOpus]);
    expect(r.code, r.out).toBe(0);
    expect(r.calls[0]).toBe('install-check.sh ' + join(r.home, 'shard', 'smoke', 'results'));
  }, 60_000);

  test('a shard mixing QM cells with another harness\'s is refused before any check', () => {
    const r = vmShard([qmCarbon, piOpus]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('shard s1 mixes 1 QM cells with other harnesses\' cells');
    expect(r.calls).toEqual([]);
  }, 60_000);

  test('--install-check on QM cells runs qm-install-check.sh on its own cells file, with no --prereg', () => {
    const r = vmShard([qmSol], ['--install-check']);
    expect(r.code, r.out).toBe(0);
    expect(r.calls).toEqual(['qm-install-check.sh ' + join(r.home, 'shard', 'results')]);
    expect(r.out).toContain('on its own cells file install-check-qm-prereg.json');
  }, 60_000);
});

describe('run-shard.sh --zdr-gate takes a QM check\'s results directory', () => {
  /** run-shard.sh on a scratch repository and a fake ubi-runner.sh, up to the zero-data-retention gate. */
  function gate(report: string | null, changeAfterCheck?: string) {
    const dir = temp('he-qm-zdr-');
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
    copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
    for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'provider-keys.sh', 'smoke-lease.ts']) copyFileSync(join(ROOT, 'scripts', 'ubicloud', f), join(repo, 'scripts', 'ubicloud', f));
    const head = init(repo);
    if (changeAfterCheck) {
      mkdirSync(join(repo, 'scripts', 'frontier-harbor'), { recursive: true });
      writeFileSync(join(repo, changeAfterCheck), '# changed after the check\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'change after the check');
    }
    const fake = join(dir, 'ubi-runner.sh');
    writeFileSync(fake, '#!/usr/bin/env bash\necho "$1" >> ' + JSON.stringify(join(dir, 'calls')) + '\ncase $1 in owner) echo harn111 ;; esac\nexit 1\n');
    chmodSync(fake, 0o755);
    const zdr = join(dir, 'gate');
    mkdirSync(zdr);
    if (report) writeFileSync(join(zdr, report), JSON.stringify({ repo_commit: head }));
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'qm-zdr-test', cells: [qmSol] }));
    const r = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), '--commit', 'HEAD', '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'qm-sol', '--lease-usd', '1', '--dest', join(dir, 'dest'), '--no-smoke', '--workload', 'frontier-harbor', '--zdr-gate', zdr], {
      cwd: dir, encoding: 'utf8', timeout: 90_000,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, TMPDIR: dir, UBI_RUNNER: fake, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'harn111', UBICLOUD_API_KEY: 'placeholder-not-a-key', ANTHROPIC_API_KEY: 'placeholder-not-a-key', OPENAI_API_KEY: 'placeholder-not-a-key' },
    });
    return { exit: r.status, stderr: r.stderr, calls: read(join(dir, 'calls')).split('\n').filter(Boolean) };
  }

  test('a QM gate directory (install-check-qm.json) passes the commit check and goes on to zdr-check.ts', () => {
    const r = gate('install-check-qm.json');
    expect(r.stderr).not.toContain('names no commit this repository holds');
    expect(r.stderr).toContain('HE-FRONTIER-013 refused: the zero-data-retention check exited');
    expect(r.calls).toEqual([]);
  }, 90_000);

  test.each(['scripts/frontier-harbor/qm_harbor.py', 'scripts/frontier-harbor/install-check-qm-prereg.json'])('a QM gate taken before %s changed is refused as not matching --commit', (file) => {
    const r = gate('install-check-qm.json', file);
    expect(r.exit).toBe(2);
    expect(r.stderr).toContain('whose harness pins or settings');
    expect(r.stderr).toContain(file);
    expect(r.calls).toEqual([]);
  }, 90_000);

  test('a gate directory with neither report is still refused as naming no commit', () => {
    const r = gate(null);
    expect(r.exit).toBe(2);
    expect(r.stderr).toContain('install-check.json names no commit this repository holds');
    expect(r.calls).toEqual([]);
  }, 90_000);
});
