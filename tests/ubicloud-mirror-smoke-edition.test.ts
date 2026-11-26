// run-shard.sh's drive mirror at teardown, keyless, no VM: the qm-driver smoke's gstack checkout
// (smoke/work/gstack-edition, pulled back with shard/smoke) holds gstack's own test text, which is key-shaped, so the mirror
// leaves that checkout out; key-shaped text anywhere else still stops the mirror.
// A frontier-harbor shard's gstack check installs gstack into each host's runtime
// (smoke/results/gstack/agents/run/gstack/<host>/runtime, or results/gstack/... in an --install-check shard): about 3.5 GB
// with node_modules hard links and gstack's key-shaped tests. The mirror leaves out each runtime/ directory under results/,
// so an --install-check shard's Harbor jobs and agent homes are still mirrored and scanned. In the smoke it leaves out the
// gstack check's whole Harbor run and trials trees (smoke/results/gstack/agents/run and trials, too many files across 43
// shards); install-check.json, the check's summaries and the rest of the smoke are still mirrored and scanned.
//
// Value: protects=each qm-driver shard's final copy reaches --replicate-to although its smoke's gstack checkout holds
// key-shaped test text, and the mirror never carries that checkout; key-shaped text in any other file, smoke results and
// other smoke work included, still keeps the previous mirror; fails_when=the final mirror is refused over the gstack
// checkout, the checkout is mirrored, or the scan stops catching key-shaped text elsewhere; seam=UBI_RUNNER with a fake
// ubi-runner.sh whose pull of shard/smoke writes the files, driven through --attach; no_claim=a real VM, ssh or tar stream.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
// Built at run time so this file holds no key-shaped literal.
const KEY_SHAPED = 'sk-' + 'ant-' + 'api03-' + 'x'.repeat(24);

// A stand-in mv for renames into the replica ($REPLICA) on the Capy drive mount; every other mv is the real one.
// MV_RENAME_INODE models the mount as measured: a renamed file keeps the inode of the name it was created under, and a new
// file created under that name gets that inode again, so a rename whose source name was already renamed onto the same
// target in an earlier call fails as "the same file" ($HOME/mv-renames keeps those pairs). MV_SAME_TMP is the older model,
// where X.tmp shares X's inode once X exists. MV_FAIL=<name> fails a rename onto <name>. MV_STALE=<name> reports a rename
// onto an existing <name> as done but leaves the old file there.
function standInMv(dir: string) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const real = spawnSync('bash', ['-c', 'command -v mv'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(bin, 'mv'), ['#!/usr/bin/env bash', 'src=${@: -2:1} dst=${@: -1}', 'case $dst in "$REPLICA"/*)',
    '  if [ -n "${MV_SAME_TMP:-}" ] && [[ $src == *.tmp ]] && [ -e "$dst" ]; then echo "mv: $src and $dst are the same file" >&2; exit 1; fi',
    '  if [ -n "${MV_FAIL:-}" ] && [[ $dst == */$MV_FAIL ]]; then echo "mv: cannot move $src to $dst" >&2; exit 1; fi',
    '  if [ -n "${MV_STALE:-}" ] && [[ $dst == */$MV_STALE ]] && [ -e "$dst" ]; then rm -f "$src"; exit 0; fi',
    '  if [ -n "${MV_RENAME_INODE:-}" ]; then',
    '    if grep -qxF "${src##*/} $dst" "$HOME/mv-renames" 2>/dev/null; then echo "mv: $src and $dst are the same file" >&2; exit 1; fi',
    '    ' + real + ' "$@" || exit; echo "${src##*/} $dst" >> "$HOME/mv-renames"; exit 0',
    '  fi ;;', 'esac', 'exec ' + real + ' "$@"'].join('\n') + '\n');
  chmodSync(join(bin, 'mv'), 0o755);
  return bin + ':' + (process.env.PATH ?? '/usr/bin:/bin');
}

// opts.again, when given, runs after a first --attach and before a second one over the same dest and replica.
function attachWithSmoke(smokeFiles: Record<string, string>, workload = 'qm-driver', links: Array<[string, string]> = [], trees: Array<[string, string]> = [], opts: { seed?: Record<string, string>; mv?: Record<string, string>; again?: (dest: string) => void; path?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'he-ubi-mirror-'));
  dirs.push(dir);
  const files = join(dir, 'smoke-files.json');
  writeFileSync(files, JSON.stringify({ files: smokeFiles, links, trees }));
  const runner = join(dir, 'ubi-runner.sh');
  writeFileSync(runner, [
    '#!/usr/bin/env bash',
    'cmd=$1; shift',
    'case "$cmd" in',
    '  pull) case "$2" in',
    '    shard/results) mkdir -p "$3/results" && echo \'{"trial_id": "t"}\' > "$3/results/turns.jsonl" && echo \'{}\' > "$3/results/run.json" ;;',
    '    shard/smoke) python3 -c \'import json, os, sys; d = json.load(open(sys.argv[1])); [os.makedirs(os.path.dirname(os.path.join(sys.argv[2], p)), exist_ok=True) or open(os.path.join(sys.argv[2], p), "w").write(t) for p, t in d["files"].items()]; [os.makedirs(os.path.dirname(os.path.join(sys.argv[2], b)), exist_ok=True) or os.link(os.path.join(sys.argv[2], a), os.path.join(sys.argv[2], b)) for a, b in d["links"]]; import shutil; [shutil.copytree(a, os.path.join(sys.argv[2], b), symlinks=True, dirs_exist_ok=True) for a, b in d["trees"]]\' ' + JSON.stringify(files) + ' "$3" ;;',
    '    *) exit 1 ;;',
    '  esac ;;',
    '  ssh) case "$2" in *"cat ~/shard/exit"*) echo 0; echo "::trials 1" ;; esac; cat > /dev/null ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n') + '\n');
  chmodSync(runner, 0o755);
  const dest = join(dir, 'dest');
  const replica = join(dir, 'replica');
  mkdirSync(dest);
  writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify({ name: 'opus-b1', vm: 'vm1', size: 'standard-16', sealed: false, workload, cleanup: 'pending' }));
  for (const [f, t] of Object.entries(opts.seed ?? {})) { mkdirSync(join(replica, 'opus-b1'), { recursive: true }); writeFileSync(join(replica, 'opus-b1', f), t); }
  const env = { ...opts.mv, REPLICA: replica, PATH: (opts.path ? opts.path + ':' : '') + (opts.mv ? standInMv(dir) : process.env.PATH ?? '/usr/bin:/bin'), HOME: dir, UBI_RUNNER: runner, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: 'placeholder-not-a-key' };
  const attach = () => spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'run-shard.sh'), '--attach', '--dest', dest, '--poll-seconds', '1', '--replicate-to', replica], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let r = attach();
  const first = { code: r.status, err: r.stderr };
  if (opts.again) { opts.again(dest); r = attach(); }
  const laneLog = existsSync(join(dest, 'lane.log')) ? readFileSync(join(dest, 'lane.log'), 'utf8') : '';
  const raw = join(replica, 'opus-b1');
  // A frontier-harbor replica is packed (results.tar.zst, smoke.tar.zst and control files); mirror is its unpacked view, so
  // the assertions below read what the replica carries either way.
  let mirror = raw;
  if (existsSync(raw) && readdirSync(raw).some((f) => /\.tar\.(?:zst|gz)$/.test(f))) {
    mirror = join(dir, 'replica-view');
    mkdirSync(mirror);
    for (const f of readdirSync(raw)) {
      if (/\.tar\.zst$/.test(f)) spawnSync('tar', ['-C', mirror, '--zstd', '-xf', join(raw, f)]);
      else if (/\.tar\.gz$/.test(f)) spawnSync('tar', ['-C', mirror, '-xzf', join(raw, f)]);
      else cpSync(join(raw, f), join(mirror, f), { recursive: true });
    }
  }
  return { code: r.status, err: r.stderr, first, dir, dest, mirror, replica: raw, laneLog };
}

describe('run-shard.sh mirrors a qm-driver shard without its smoke\'s gstack checkout', () => {
  test('key-shaped test text in smoke/work/gstack-edition no longer stops the final mirror, and the checkout is not mirrored', () => {
    const r = attachWithSmoke({
      'smoke/work/gstack-edition/test/fixtures/redact.test.ts': 'const fake = "' + KEY_SHAPED + '";\n',
      'smoke/results/run.stdout.log': 'dry run ok\n',
    });
    expect(r.code, r.err).toBe(0);
    expect(existsSync(join(r.dest, 'smoke', 'work', 'gstack-edition', 'test', 'fixtures', 'redact.test.ts'))).toBe(true);
    expect(r.laneLog).not.toContain('key-shaped text');
    expect(readFileSync(join(r.mirror, 'results', 'turns.jsonl'), 'utf8')).toContain('"trial_id"');
    expect(existsSync(join(r.mirror, 'smoke', 'results', 'run.stdout.log'))).toBe(true);
    expect(existsSync(join(r.mirror, 'smoke', 'work', 'gstack-edition'))).toBe(false);
  }, 60_000);

  for (const [where, path] of [['the smoke results', 'smoke/results/run.stdout.log'], ['other smoke work', 'smoke/work/other/notes.txt'], ['a lookalike path', 'smoke/work/gstack-edition-copy/x.txt']] as const) {
    test('key-shaped text in ' + where + ' still keeps the mirror from being written', () => {
      const r = attachWithSmoke({ 'smoke/work/gstack-edition/a.txt': KEY_SHAPED, [path]: 'leaked ' + KEY_SHAPED + '\n' });
      expect(r.code, r.err).toBe(0);
      expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in ' + path);
      expect(existsSync(join(r.mirror, 'results'))).toBe(false);
      expect(existsSync(join(r.mirror, 'smoke'))).toBe(false);
    }, 60_000);
  }
});

describe('run-shard.sh mirrors a frontier-harbor shard without the gstack smoke\'s copies of gstack\'s own tests', () => {
  const GSTACK_TEST = 'smoke/results/gstack/agents/run/gstack/hermes/runtime/root/.local/share/gstack/test/redact-engine.test.ts';
  const JOB_LOG = 'smoke/results/gstack/agents/run/jobs/hermes-opus-full__a1/t1/trial.log';
  test('key-shaped test text in a gstack runtime\'s test directory no longer stops the mirror, and that directory is not mirrored', () => {
    const r = attachWithSmoke({ [GSTACK_TEST]: 'const fake = "' + KEY_SHAPED + '";\n', [JOB_LOG]: 'trial ok\n' }, 'frontier-harbor');
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).not.toContain('key-shaped text');
    expect(existsSync(join(r.dest, JOB_LOG))).toBe(true);
    expect(existsSync(join(r.mirror, JOB_LOG))).toBe(false);
    expect(existsSync(join(r.mirror, GSTACK_TEST))).toBe(false);
  }, 60_000);

  for (const path of ['smoke/results/gstack/gstack-check.log', 'smoke/results/agents/run/jobs/hermes-opus__a1/t1/trial.log', 'smoke/results/gstack/skill-start/hermes.run1.txt'] as const) {
    test('key-shaped text in ' + path + ' still keeps the mirror from being written', () => {
      const r = attachWithSmoke({ [GSTACK_TEST]: KEY_SHAPED, [path]: 'leaked ' + KEY_SHAPED + '\n' }, 'frontier-harbor');
      expect(r.code, r.err).toBe(0);
      expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in ' + path);
      expect(existsSync(join(r.mirror, 'smoke'))).toBe(false);
    }, 60_000);
  }
});

describe('run-shard.sh mirrors a frontier-harbor install-check shard without the copies of gstack\'s own tests in its results', () => {
  const runtimeTest = (host: string) => 'results/gstack/agents/run/gstack/' + host + '/runtime/root/.local/share/gstack/test/redact-engine.test.ts';
  const JOB_LOG = 'results/gstack/agents/run/jobs/codex-sol-full__a1/t1/trial.log';
  test('key-shaped test text in results/gstack/agents/run/gstack/<host>/runtime/root/.local/share/gstack/test no longer stops the mirror, and that directory is not mirrored', () => {
    const r = attachWithSmoke({ [runtimeTest('codex')]: 'const fake = "' + KEY_SHAPED + '";\n', [runtimeTest('hermes')]: 'const fake = "' + KEY_SHAPED + '";\n', [JOB_LOG]: 'trial ok\n' }, 'frontier-harbor');
    expect(r.code, r.err).toBe(0);
    expect(existsSync(join(r.dest, runtimeTest('codex')))).toBe(true);
    expect(r.laneLog).not.toContain('key-shaped text');
    expect(readFileSync(join(r.mirror, 'results', 'turns.jsonl'), 'utf8')).toContain('"trial_id"');
    expect(existsSync(join(r.mirror, JOB_LOG))).toBe(true);
    expect(existsSync(join(r.mirror, runtimeTest('codex')))).toBe(false);
    expect(existsSync(join(r.mirror, runtimeTest('hermes')))).toBe(false);
  }, 60_000);

  for (const path of [JOB_LOG, 'results/gstack/agents/run/gstack/codex/home/notes.txt', 'results/gstack/agents/run/gstack/codex/runtime-old/x.ts', 'results/gstack/agents/run/gstack/codex/SKILL.md'] as const) {
    test('key-shaped text in ' + path + ' still keeps the mirror from being written', () => {
      const r = attachWithSmoke({ [runtimeTest('codex')]: KEY_SHAPED, [path]: 'leaked ' + KEY_SHAPED + '\n' }, 'frontier-harbor');
      expect(r.code, r.err).toBe(0);
      expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in ' + path);
      expect(existsSync(join(r.mirror, 'results'))).toBe(false);
    }, 60_000);
  }

  test('a qm-driver shard keeps no such exclude: key-shaped text there still stops its mirror', () => {
    const r = attachWithSmoke({ [runtimeTest('codex')]: KEY_SHAPED });
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in ' + runtimeTest('codex'));
  }, 60_000);
});

describe('run-shard.sh mirrors a frontier-harbor shard without the gstack check\'s installed runtimes', () => {
  const runtime = (root: string, host: string) => root + '/gstack/agents/run/gstack/' + host + '/runtime';
  for (const root of ['smoke/results', 'results'] as const) {
    test('a runtime tree under ' + root + ' with a node_modules hard link is left out of the mirror, and the local pull keeps it', () => {
      const r = attachWithSmoke({
        [runtime(root, 'hermes') + '/root/.local/share/gstack/node_modules/a/index.js']: 'module.exports = 1;\n',
        [runtime(root, 'hermes') + '/root/.local/share/gstack/test/redact-engine.test.ts']: 'const fake = "' + KEY_SHAPED + '";\n',
        [runtime(root, 'hermes') + '/root/.local/share/gstack/tests/x.ts']: KEY_SHAPED,
        [runtime(root, 'hermes') + '/root/.local/share/gstack/SKILL.md']: KEY_SHAPED,
        [root + '/gstack/agents/run/jobs/hermes-opus-full__a1/t1/trial.log']: 'trial ok\n',
      }, 'frontier-harbor', [[runtime(root, 'hermes') + '/root/.local/share/gstack/node_modules/a/index.js', runtime(root, 'hermes') + '/root/.local/share/gstack/node_modules/b/index.js']]);
      expect(r.code, r.err).toBe(0);
      expect(r.laneLog).not.toContain('WARNING: replicate');
      expect(existsSync(join(r.dest, runtime(root, 'hermes'), 'root/.local/share/gstack/node_modules/b/index.js'))).toBe(true);
      expect(existsSync(join(r.mirror, root + '/gstack/agents/run/jobs/hermes-opus-full__a1/t1/trial.log'))).toBe(root === 'results');
      expect(existsSync(join(r.mirror, runtime(root, 'hermes')))).toBe(false);
      expect(existsSync(join(r.mirror, root + '/gstack/agents/run/gstack/hermes'))).toBe(root === 'results');
    }, 60_000);
  }
  for (const path of ['results/gstack/agents/run/gstack/codex/home/notes.txt', 'results/gstack/agents/run/gstack/codex/runtime.txt', 'results/gstack/agents/run/gstack/codex/SKILL.md', 'results/gstack/agents/run/gstack/codex/runtime-copy/x.ts', 'results/gstack/agents/run/jobs/codex-sol-full__a1/t1/trial.log'] as const) {
    test('key-shaped text in ' + path + ', outside runtime/, still keeps the mirror from being written', () => {
      const r = attachWithSmoke({ ['results/gstack/agents/run/gstack/codex/runtime/root/x']: KEY_SHAPED, [path]: 'leaked ' + KEY_SHAPED + '\n' }, 'frontier-harbor');
      expect(r.code, r.err).toBe(0);
      expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in ' + path);
      expect(existsSync(join(r.mirror, 'results'))).toBe(false);
    }, 60_000);
  }
});

describe('run-shard.sh mirrors a frontier-harbor shard without the gstack check\'s Harbor job trees under smoke/ (Amendment 1, added 2026-11-15 (3))', () => {
  const G = 'smoke/results/gstack/agents';
  const left = [G + '/run/jobs/cc-opus-full__a1/cobol-modernization__x/agent/trajectory.json', G + '/run/gstack/hermes/home/notes.txt', G + '/trials/cc-opus-full/cobol-modernization/a1/result.json', G + '/trials/cc-opus-minus-retro/cobol-modernization/a1/harbor/trial.log'];
  const kept = ['smoke/results/install-check.json', 'smoke/results/gstack/gstack-check.json', 'smoke/results/gstack/gstack-check.log', G + '/trials.jsonl', G + '/run-summary.json', G + '/manifest.json', 'smoke/results/gstack/skill-start/hermes.run1.txt', 'smoke/results/agents/trials.jsonl', 'smoke/results/agents/run-summary.json', 'results/gstack/agents/run/jobs/codex-sol-full__a1/t1/trial.log', 'results/gstack/agents/trials/codex-sol-full/t1/a1/result.json'];
  test('the check\'s run/ and trials/ trees under smoke/ are left out of the mirror, the local pull keeps them, and install-check.json and the per-check summaries are mirrored', () => {
    const r = attachWithSmoke(Object.fromEntries([...left.map((p) => [p, 'const fake = "' + KEY_SHAPED + '";\n']), ...kept.map((p) => [p, '{}\n'])]), 'frontier-harbor');
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).not.toContain('WARNING: replicate');
    for (const p of left) { expect(existsSync(join(r.dest, p))).toBe(true); expect(existsSync(join(r.mirror, p))).toBe(false); }
    for (const p of kept) expect(existsSync(join(r.mirror, p))).toBe(true);
  }, 60_000);
  for (const path of ['smoke/results/gstack/gstack-check.log', G + '/run-summary.json', 'smoke/results/agents/run/jobs/cc-opus__a1/t1/trial.log'] as const) {
    test('key-shaped text in ' + path + ', which is still mirrored, still keeps the mirror from being written', () => {
      const r = attachWithSmoke({ [left[0]!]: KEY_SHAPED, [path]: 'leaked ' + KEY_SHAPED + '\n' }, 'frontier-harbor');
      expect(r.code, r.err).toBe(0);
      expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in ' + path);
      expect(existsSync(join(r.mirror, 'smoke'))).toBe(false);
    }, 60_000);
  }
  test('a qm-driver shard keeps no such exclude', () => {
    const r = attachWithSmoke({ [left[0]!]: KEY_SHAPED });
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in ' + left[0]);
  }, 60_000);
});


describe('run-shard.sh mirrors each finished trial\'s work trees, and only once it has finished (Amendment 1, added 2026-11-15 (3))', () => {
  const art = (task: string) => 'results/trials/sol-pi-hook/' + task + '/a1/harbor/artifacts';
  const done = art('gd-dev-ship-01'), running = art('gd-dev-ship-02');
  const journal = JSON.stringify({ journaled_at: '2026-11-15T00:00:00Z', record: { trial_id: 'gstack-delivery-2026-11/sol-pi-hook/gd-dev-ship-01/a1', cell: 'sol-pi-hook' } }) + '\n';
  const base = (extra: Record<string, string> = {}) => ({
    [done + '/work/repo/pkg/a.py']: 'x = 1\n', [done + '/work/repo/.git/HEAD']: 'ref: refs/heads/feature/x\n', [done + '/work/remote.git/HEAD']: 'ref: refs/heads/main\n',
    [done + '/work/out/review.json']: '[]\n', [done + '/manifest.json']: '{}\n', [running + '/work/repo/pkg/a.py']: 'x = 2\n', 'results/trials.journal.jsonl': journal, ...extra,
  });
  test('a finished trial\'s repo and remote.git that are no repository of its task base go in raw, with a log line, beside its other files; a running trial\'s are not; no per-trial archive; the local pull keeps both', () => {
    const r = attachWithSmoke(base(), 'frontier-harbor');
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).not.toContain('WARNING: replicate');
    expect(r.laneLog).toContain('replicate: ' + done + ' keeps its raw work trees in ');
    for (const f of ['/work/repo/pkg/a.py', '/work/repo/.git/HEAD', '/work/remote.git/HEAD', '/work/out/review.json', '/manifest.json']) expect(existsSync(join(r.mirror, done + f))).toBe(true);
    expect(existsSync(join(r.mirror, running, 'work/repo'))).toBe(false);
    expect(spawnSync('find', [r.mirror, '-name', 'work-trees.tar*'], { encoding: 'utf8' }).stdout.trim()).toBe('');
    expect(existsSync(join(r.dest, running, 'work/repo/pkg/a.py'))).toBe(true);
    expect(existsSync(join(r.dest, done, 'work/remote.git/HEAD'))).toBe(true);
  }, 60_000);
  test('key-shaped text in a running trial\'s work tree is not packed, so it does not stop the replica until the trial finishes', () => {
    const r = attachWithSmoke(base({ [running + '/work/repo/pkg/settings.py']: 'TOKEN = "' + KEY_SHAPED + '"\n' }), 'frontier-harbor');
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).not.toContain('WARNING: replicate');
    expect(existsSync(join(r.mirror, done, 'work/repo/pkg/a.py'))).toBe(true);
  }, 60_000);
  // A real repository on the ship-01 base: one commit pushed to remote.git, one not, and an untracked file.
  const session = (secret = 'harmless') => {
    const d = mkdtempSync(join(tmpdir(), 'he-ubi-work-'));
    dirs.push(d);
    expect(spawnSync('tar', ['-C', d, '-xf', join(ROOT, 'tasks/repo/gstack-delivery-v1/dev/gd-dev-ship-01/environment/work.tar')]).status).toBe(0);
    const git = (...a: string[]) => expect(spawnSync('git', ['-C', join(d, 'repo'), '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...a], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: d, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).status).toBe(0);
    writeFileSync(join(d, 'repo', 'VERSION'), '9.9.9\n');
    git('commit', '-qam', 'bump');
    git('push', '-q', '../remote.git', 'HEAD:refs/heads/feature/3a9dd9');
    writeFileSync(join(d, 'repo', 'notes.txt'), 'TOKEN = "' + secret + '"\n');
    git('add', 'notes.txt');
    git('commit', '-qm', 'notes');
    git('rm', '-q', 'notes.txt');
    git('commit', '-qm', 'drop notes');
    writeFileSync(join(d, 'repo', 'untracked.txt'), 'left over\n');
    return d;
  };
  test('a finished trial\'s real repository goes in as bundles, refs and a diff against the task base, and rebuilds to the raw tree', () => {
    const w = session();
    const r = attachWithSmoke({ [done + '/work/out/review.json']: '[]\n', 'results/trials.journal.jsonl': journal }, 'frontier-harbor', [], [[w, done + '/work']]);
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).not.toContain('WARNING: replicate');
    expect(r.laneLog).not.toContain('keeps its raw work trees');
    expect(existsSync(join(r.mirror, done, 'work/repo'))).toBe(false);
    expect(existsSync(join(r.mirror, done, 'work/remote.git'))).toBe(false);
    expect(existsSync(join(r.mirror, done, 'work/out/review.json'))).toBe(true);
    expect(readdirSync(join(r.mirror, done, 'work-git')).sort()).toEqual(['base.sha256', 'remote.git.bundle', 'remote.git.head', 'remote.git.refs', 'repo.bundle', 'repo.diff', 'repo.head', 'repo.logs', 'repo.refs']);
    expect(existsSync(join(r.dest, done, 'work/repo/untracked.txt'))).toBe(true);
    const out = join(r.dest, '..', 'rebuilt');
    const b = spawnSync('bash', [join(ROOT, 'scripts/frontier-harbor/work-git.sh'), 'rebuild', join(r.mirror, done, 'work-git'), join(ROOT, 'tasks/repo/gstack-delivery-v1/dev/gd-dev-ship-01/environment/work.tar'), out], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: out + '.home' } });
    expect(b.status, b.stderr).toBe(0);
    expect(spawnSync('diff', ['-r', '-q', '--no-dereference', '-x', '.git', join(w, 'repo'), join(out, 'repo')], { encoding: 'utf8' }).stdout).toBe('');
    const refs = (g: string) => spawnSync('git', ['-C', g, 'for-each-ref'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: out + '.home' } }).stdout;
    expect(refs(join(out, 'repo'))).toBe(refs(join(w, 'repo')));
    expect(refs(join(out, 'remote.git'))).toBe(refs(join(w, 'remote.git')));
  }, 60_000);
  test('key-shaped text in a commit a finished trial\'s final tree no longer holds keeps the mirror from being written', () => {
    const r = attachWithSmoke({ 'results/trials.journal.jsonl': journal }, 'frontier-harbor', [], [[session(KEY_SHAPED), done + '/work']]);
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in a commit of repo in ' + done + '/work');
    expect(r.laneLog).not.toContain(KEY_SHAPED);
    expect(existsSync(join(r.replica, 'results.tar.zst')) || existsSync(join(r.replica, 'results.tar.gz'))).toBe(false);
  }, 60_000);
  // Value: protects=a pulled trial whose artifacts/work or harbor folder is a symlink to a repository outside <dest> is
  // neither packed (no git command runs on it or a copy of it) nor copied raw, nothing of it reaches the replica, and
  // other trials still mirror; fails_when=finished_trees and work-git.sh follow the symlinked parent, as before this check,
  // so git runs on a copy of the outside repository, its files are scanned and copied, and its key-shaped file stops the
  // whole mirror; seam=a fake pull whose tree holds the symlink and a git stand-in on PATH that records any call on a
  // repository holding the outside sentinel; no_claim=a real VM or a symlink inside work/repo (work-git.sh's own test).
  for (const level of ['work', 'harbor'] as const) {
    test('a finished trial whose ' + (level === 'work' ? 'artifacts/work' : 'harbor folder') + ' is a symlink out of <dest> is logged, never packed or copied, and the other trials still mirror', () => {
      const scratch = mkdtempSync(join(tmpdir(), 'he-ubi-outside-'));
      dirs.push(scratch);
      const marker = join(scratch, 'marker');
      const outside = session();
      writeFileSync(join(outside, 'repo', 'OUTSIDE-SENTINEL'), 'outside\n');
      writeFileSync(join(outside, 'repo', 'creds.txt'), 'TOKEN = "' + KEY_SHAPED + '"\n');
      mkdirSync(join(outside, 'repo', '.git', 'hooks'), { recursive: true });
      for (const h of ['post-checkout', 'reference-transaction', 'pre-commit']) { writeFileSync(join(outside, 'repo', '.git', 'hooks', h), '#!/bin/sh\ntouch ' + JSON.stringify(marker) + '\n'); chmodSync(join(outside, 'repo', '.git', 'hooks', h), 0o755); }
      const realGit = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
      const bin = join(scratch, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'git'), ['#!/usr/bin/env bash', 'd=$PWD prev=""', 'for a in "$@"; do [ "$prev" != -C ] || d=$a; prev=$a; done', '[ ! -e "$d/OUTSIDE-SENTINEL" ] || echo "git $*" >> ' + JSON.stringify(marker), 'exec ' + realGit + ' "$@"'].join('\n') + '\n');
      chmodSync(join(bin, 'git'), 0o755);
      const trial = 'results/trials/sol-pi-hook/gd-dev-ship-01/a1';
      const other = 'results/trials/opus-pi-hook/gd-dev-ship-01/a1/harbor/artifacts';
      const links = join(scratch, 'links');
      mkdirSync(links);
      let root = outside, cut = done + '/work', into = done;
      if (level === 'work') symlinkSync(outside, join(links, 'work'));
      else {
        root = join(scratch, 'harbor');
        mkdirSync(join(root, 'artifacts'), { recursive: true });
        renameSync(outside, join(root, 'artifacts', 'work'));
        symlinkSync(root, join(links, 'harbor'));
        cut = trial + '/harbor';
        into = trial;
      }
      const two = [journal, JSON.stringify({ record: { trial_id: 'gstack-delivery-2026-11/opus-pi-hook/gd-dev-ship-01/a1' } }) + '\n'].join('');
      const r = attachWithSmoke({ 'results/trials.journal.jsonl': two, [other + '/manifest.json']: '{}\n' }, 'frontier-harbor', [], [[links, into], [session(), other + '/work']], { path: bin });
      expect(r.code, r.err).toBe(0);
      expect(r.laneLog).toContain('WARNING: replicate: ' + done + '/work has a symlink on its path; its work trees are neither packed nor copied');
      expect(r.laneLog).not.toContain('key-shaped text');
      expect(r.laneLog).not.toContain(KEY_SHAPED);
      expect(existsSync(marker)).toBe(false);
      expect(spawnSync('find', [root, '-name', 'work-git'], { encoding: 'utf8' }).stdout.trim()).toBe('');
      const archive = readdirSync(r.replica).find((x) => /^results\.tar\.(zst|gz)$/.test(x));
      expect(archive).toBeDefined();
      const list = spawnSync('tar', ['-tf', join(r.replica, archive!)], { encoding: 'utf8' }).stdout.split('\n');
      expect(list.filter((l) => l === cut || l.startsWith(cut + '/') || l.startsWith(done + '/work-git'))).toEqual([]);
      expect(readdirSync(join(r.mirror, other, 'work-git'))).toContain('repo.bundle');
      expect(existsSync(join(r.mirror, other, 'manifest.json'))).toBe(true);
    }, 60_000);
  }
  test('key-shaped text in a finished trial\'s work tree is found before packing and keeps the mirror from being written', () => {
    const path = done + '/work/repo/pkg/settings.py';
    const r = attachWithSmoke(base({ [path]: 'TOKEN = "' + KEY_SHAPED + '"\n' }), 'frontier-harbor');
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in ' + path);
    expect(existsSync(join(r.mirror, 'results'))).toBe(false);
  }, 60_000);
});


describe('run-shard.sh packs a frontier-harbor replica into results and smoke archives (Amendment 1, added 2026-11-15 (3))', () => {
  const art = 'results/trials/sol-pi-hook/gd-dev-ship-01/a1/harbor/artifacts';
  const files = { [art + '/work/repo/pkg/a.py']: 'x = 1\n', [art + '/work/out/review.json']: '[]\n', 'results/trials.journal.jsonl': JSON.stringify({ record: { trial_id: 'r/sol-pi-hook/gd-dev-ship-01/a1' } }) + '\n', 'smoke/results/install-check.json': '{}\n', 'smoke/results/gstack/gstack-check.json': '{}\n' };
  test('the replica holds results.tar.zst (or .gz), smoke.tar.zst and the control files, with no tree, temporary file or per-trial archive', () => {
    const r = attachWithSmoke(files, 'frontier-harbor');
    expect(r.code, r.err).toBe(0);
    const top = readdirSync(r.replica).sort();
    const ext = top.includes('results.tar.zst') ? 'zst' : 'gz';
    expect(top).toContain('results.tar.' + ext);
    expect(top).toContain('smoke.tar.' + ext);
    expect(top).toContain('shard-vm.json');
    expect(top.filter((f) => f === 'results' || f === 'smoke' || f.endsWith('.tmp') || f.includes('.part'))).toEqual([]);
    const list = (a: string) => spawnSync('tar', ['-tf', join(r.replica, a)], { encoding: 'utf8' }).stdout.split('\n');
    expect(list('results.tar.' + ext)).toContain(art + '/work/repo/pkg/a.py');
    expect(list('results.tar.' + ext)).toContain('results/turns.jsonl');
    expect(list('results.tar.' + ext).some((l) => l.includes('work-trees.tar'))).toBe(false);
    expect(list('smoke.tar.' + ext)).toContain('smoke/results/install-check.json');
    expect(JSON.parse(readFileSync(join(r.replica, 'shard-vm.json'), 'utf8'))).toMatchObject({ vm: 'vm1' });
  }, 60_000);
  test('key-shaped text anywhere that would be packed keeps the previous replica', () => {
    const r = attachWithSmoke({ ...files, [art + '/work/repo/pkg/settings.py']: 'TOKEN = "' + KEY_SHAPED + '"\n' }, 'frontier-harbor');
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).toContain('WARNING: replicate: key-shaped text in ' + art + '/work/repo/pkg/settings.py');
    expect(existsSync(r.replica) ? readdirSync(r.replica).filter((f) => f.includes('.tar.')) : []).toEqual([]);
  }, 60_000);
  test('a second pass renames over the previous archives and files on a mount where X.tmp shares X\'s inode', () => {
    const r = attachWithSmoke(files, 'frontier-harbor', [], [], { seed: { 'results.tar.zst': 'old', 'results.tar.gz': 'old', 'smoke.tar.zst': 'old', 'smoke.tar.gz': 'old', 'lane.log': 'old\n', 'shard-vm.json': '{}' }, mv: { MV_SAME_TMP: '1' } });
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).not.toContain('WARNING: replicate');
    const top = readdirSync(r.replica);
    const ext = spawnSync('bash', ['-c', 'command -v zstd'], { encoding: 'utf8' }).status === 0 ? 'zst' : 'gz';
    expect(top.filter((f) => f.endsWith('.tmp') || f.includes('.part'))).toEqual([]);
    expect(spawnSync('tar', ['-tf', join(r.replica, 'results.tar.' + ext)], { encoding: 'utf8' }).stdout.split('\n')).toContain('results/turns.jsonl');
    expect(readFileSync(join(r.replica, 'lane.log'), 'utf8')).not.toBe('old\n');
    expect(JSON.parse(readFileSync(join(r.replica, 'shard-vm.json'), 'utf8'))).toMatchObject({ vm: 'vm1' });
  }, 60_000);
  test('a loose file that cannot be copied is logged and does not keep results.tar from being written', () => {
    const r = attachWithSmoke(files, 'frontier-harbor', [], [], { mv: { MV_FAIL: 'lane.log' } });
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).toContain('WARNING: replicate: copying lane.log into ');
    const top = readdirSync(r.replica);
    expect(top.some((f) => /^results\.tar\.(zst|gz)$/.test(f))).toBe(true);
    expect(top.some((f) => /^smoke\.tar\.(zst|gz)$/.test(f))).toBe(true);
    expect(top.filter((f) => f.includes('lane.log.part'))).toEqual([]);
  }, 60_000);
  test('a second pass replaces the archives and the loose files on a mount where a renamed file keeps the inode of its temp name', () => {
    const r = attachWithSmoke(files, 'frontier-harbor', [], [], { mv: { MV_RENAME_INODE: '1' }, again: (dest) => {
      writeFileSync(join(dest, 'results', 'pass-2.txt'), '2\n');
      writeFileSync(join(dest, 'smoke', 'results', 'pass-2.txt'), '2\n');
    } });
    expect(r.first.code, r.first.err).toBe(0);
    expect(r.code, r.err).toBe(0);
    expect(readFileSync(join(r.dir, 'mv-renames'), 'utf8')).toContain('/opus-b1/results.tar.');
    expect(r.laneLog).not.toContain('WARNING: replicate');
    const top = readdirSync(r.replica);
    const ext = top.includes('results.tar.zst') ? 'zst' : 'gz';
    expect(top.filter((f) => f.endsWith('.tmp') || f.includes('.part'))).toEqual([]);
    const list = (a: string) => spawnSync('tar', ['-tf', join(r.replica, a)], { encoding: 'utf8' }).stdout.split('\n');
    expect(list('results.tar.' + ext)).toContain('results/pass-2.txt');
    expect(list('smoke.tar.' + ext)).toContain('smoke/results/pass-2.txt');
    const renames = readFileSync(join(r.dir, 'mv-renames'), 'utf8').split('\n');
    for (const t of ['results.tar.' + ext, 'smoke.tar.' + ext, 'lane.log', 'shard-vm.json']) expect(renames.filter((l) => l.endsWith('/opus-b1/' + t)).length, t).toBe(2);
    expect(readFileSync(join(r.replica, 'lane.log'), 'utf8').split('attaching to vm1').length - 1).toBe(2);
  }, 120_000);
  test('a rename that reports success but leaves the old file is caught by the size check, logged, and the archives are still written', () => {
    const r = attachWithSmoke(files, 'frontier-harbor', [], [], { seed: { 'lane.log': 'old\n' }, mv: { MV_STALE: 'lane.log' } });
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).toContain('WARNING: replicate: copying lane.log into ');
    expect(readdirSync(r.replica).some((f) => /^results\.tar\.(zst|gz)$/.test(f))).toBe(true);
  }, 60_000);
  test('a qm-driver replica stays a file-by-file tree', () => {
    const r = attachWithSmoke({ 'smoke/results/x.txt': 'ok\n' });
    expect(r.code, r.err).toBe(0);
    expect(existsSync(join(r.replica, 'smoke/results/x.txt'))).toBe(true);
    expect(readdirSync(r.replica).some((f) => f.includes('.tar.'))).toBe(false);
  }, 60_000);
});


describe('run-shard.sh checks the replica\'s temp-then-rename path before any VM call (Amendment 1, added 2026-11-15 (3))', () => {
  function launch(mv: Record<string, string>, seed: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'he-ubi-replica-preflight-'));
    dirs.push(dir);
    for (const [f, t] of Object.entries(seed)) { mkdirSync(join(dir, 'replica', 's1'), { recursive: true }); writeFileSync(join(dir, 'replica', 's1', f), t); }
    const runner = join(dir, 'ubi-runner.sh');
    writeFileSync(runner, '#!/usr/bin/env bash\necho "$*" >> ' + JSON.stringify(join(dir, 'calls')) + '\nexit 1\n');
    chmodSync(runner, 0o755);
    const replica = join(dir, 'replica');
    const commit = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } }).stdout.trim();
    // The preregistration does not exist, so a launch that gets past the preflight stops there, before any VM call.
    const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'run-shard.sh'), '--commit', commit, '--prereg', join(dir, 'missing.json'), '--name', 's1', '--cells', 'c1', '--lease-usd', '1', '--dest', join(dir, 'dest'), '--replicate-to', replica],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...mv, REPLICA: replica, PATH: standInMv(dir), HOME: dir, UBI_RUNNER: runner, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: 'placeholder-not-a-key', ANTHROPIC_API_KEY: 'placeholder-not-a-key' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const left = existsSync(join(replica, 's1')) ? readdirSync(join(replica, 's1')) : [];
    return { r, dir, left, calls: existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '' };
  }
  test('a probe that cannot be renamed into the replica refuses the launch with exit 2 and leaves nothing behind', () => {
    const { r, left, calls } = launch({ MV_FAIL: '.replica-probe' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('refused: the replica preflight');
    expect(r.stderr).not.toContain('is neither a path in the repository');
    expect(calls).toBe('');
    expect(left).toEqual([]);
  }, 60_000);
  test('on a mount where a renamed file keeps the inode of its temp name, the probe is written and replaced twice and the launch goes on', () => {
    const { r, dir, left, calls } = launch({ MV_RENAME_INODE: '1' });
    expect(r.stderr).not.toContain('replica preflight');
    expect(r.stderr).toContain('is neither a path in the repository');
    expect(readFileSync(join(dir, 'mv-renames'), 'utf8').split('\n').filter((l) => l.endsWith('/s1/.replica-probe')).length).toBe(2);
    expect(calls).toBe('');
    expect(left).toEqual([]);
  }, 60_000);
  test('the preflight deletes a part file a dead controller left in the replica and keeps one whose pid is alive', () => {
    const stale = '.results.tar.zst.part.' + spawnSync('true').pid + '.1763000000000000000', live = '.lane.log.part.' + process.pid + '.1763000000000000001';
    const { r, left, calls } = launch({}, { [stale]: 'cut short', [live]: 'still writing' });
    expect(r.stderr).not.toContain('replica preflight');
    expect(calls).toBe('');
    expect(left).toEqual([live]);
  }, 60_000);
  test('the preflight keeps a dead pid\'s part file whose write started less than 6 hours ago, which may be another machine\'s', () => {
    const fresh = '.results.tar.zst.part.' + spawnSync('true').pid + '.' + (BigInt(Date.now()) * 1000000n).toString();
    const { r, left, calls } = launch({}, { [fresh]: 'another machine still writing' });
    expect(r.stderr).not.toContain('replica preflight');
    expect(calls).toBe('');
    expect(left).toEqual([fresh]);
  }, 60_000);
});


describe('run-shard.sh clears the part files a killed controller left in the replica', () => {
  // Value: protects=a part file whose writer died (a controller killed mid-write) is deleted by the next mirror instead of
  // staying in the drive folder forever, one whose pid is alive is left to its writer, and a failed archive write leaves
  // no part file; fails_when=mirror() never looks at old part files, as before; seam=attachWithSmoke's seeded replica and
  // the stand-in mv; no_claim=a writer on another machine sharing the drive folder whose write has run for more than 6 hours.
  const files = { 'results/trials/sol-pi-hook/gd-dev-ship-01/a1/harbor/artifacts/work/out/review.json': '[]\n', 'smoke/results/install-check.json': '{}\n' };
  test('the next mirror deletes a part file whose pid is dead and keeps one whose pid is alive', () => {
    const stale = '.results.tar.zst.part.' + spawnSync('true').pid + '.1763000000000000000', live = '.lane.log.part.' + process.pid + '.1763000000000000001';
    const r = attachWithSmoke(files, 'frontier-harbor', [], [], { seed: { [stale]: 'cut short', [live]: 'still writing' } });
    expect(r.code, r.err).toBe(0);
    const top = readdirSync(r.replica);
    expect(top).not.toContain(stale);
    expect(top).toContain(live);
    expect(top.some((x) => /^results\.tar\.(zst|gz)$/.test(x))).toBe(true);
  }, 60_000);
  test('an archive write that fails leaves no part file behind', () => {
    const ext = spawnSync('bash', ['-c', 'command -v zstd'], { encoding: 'utf8' }).status === 0 ? 'zst' : 'gz';
    const r = attachWithSmoke(files, 'frontier-harbor', [], [], { mv: { MV_FAIL: 'results.tar.' + ext } });
    expect(r.code, r.err).toBe(0);
    expect(r.laneLog).toContain('WARNING: replicate: packing results into ');
    expect(readdirSync(r.replica).filter((x) => x.includes('.part.'))).toEqual([]);
  }, 60_000);
});
