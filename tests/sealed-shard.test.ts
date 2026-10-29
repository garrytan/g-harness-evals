// internal-task phase 3: the shard lane and the gbrain image take a custodian's sealed root (docs/sealed-custody.md). Keyless, no
// VM; the docker tests run only where 'docker info' succeeds.
//
// Value: protects=scripts/ubicloud/run-shard.sh streams the sealed root to ~/sealed/root and the receipt to
// ~/sealed/opening-receipt.json on the VM (outside the checkout), on --resume too, hands vm-shard.sh the VM paths, deletes
// ~/sealed before the VM is destroyed on every exit (a failed run and --attach included), never forwards anything but the
// two model keys, records the destroy only after down succeeds (a failed down keeps the VM id in cleanup-pending), prints
// only the trial count in a sealed lane's poll lines, and refuses a --dest inside a git work tree, on a sealed --attach too
// before it polls or pulls; fails_when=the upload
// or the cleanup is skipped on some path, an identity-looking value rides along with the model keys, a failed down is
// recorded as destroyed, a shard log line reaches the controller's output, or a sealed run can write its raw results into
// a checkout; why_new=the sealed lane is
// new; seam=UBI_RUNNER (existing) with a fake ubi-runner.sh that records every call; no_claim=a real VM, real ssh or tar on it.
//
// Value: protects=fanout.sh passes both sealed flags to every shard and refuses a manifest with only one; vm-shard.sh passes
// them and the sealed image to the counted run only and runs the smoke as a public dev run on the public image (HE-SEALED-005
// refuses a sealed image there); scripts/run-shard.sh refuses half the pair and a results directory inside the checkout or
// any other git work tree before any build or log, and records its private copy in <out>/sealed-root-copy.path; build-gbrain-image.sh checks both digests against the receipt (HE-SEALED-005), refuses a root
// inside the checkout and with --embedded, and adds the named contexts and digests only when sealed; fails_when=a shard runs
// sealed without its flags, a mismatched root builds, or the public build line changes; why_new=the flags are new;
// seam=dry runs, fake docker, git and bun; no_claim=runner/run.ts's handling of the flags (the TypeScript tests cover it).
//
// Value: protects=gbrain/Dockerfile's world-input and heldout-corpus stages are replaced by BuildKit named contexts and
// default to the public world and an empty overlay; fails_when=the stage names drift from what build-gbrain-image.sh passes,
// so a sealed build would silently use the public world; why_new=the stages are new; seam=docker build of the two scratch
// stages only, exported with -o type=local; no_claim=the full image build (tests/gbrain-image.test.ts and the build lane).

import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PLACEHOLDER = 'placeholder';
const COMMIT = 'a'.repeat(40);
const CELLS = [{ id: 'sonnet', harness: 'hermes', model: 'anthropic:claude-sonnet-5-5' }];
const VM_ROOT = '/home/ubi/sealed/root';
const VM_RECEIPT = '/home/ubi/sealed/opening-receipt.json';
const VM_FLAGS = '--sealed-root ' + VM_ROOT + ' --opening-receipt ' + VM_RECEIPT;

const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

function fake(dir: string, name: string, body: string) {
  const f = join(dir, name);
  writeFileSync(f, '#!/usr/bin/env bash\n' + body + '\n');
  chmodSync(f, 0o755);
}

// A synthetic custodian's root, with the receipt's digests computed by the definitions in docs/sealed-custody.md.
function sealedRoot(opts: { worldDigest?: string; corpusDigest?: string; emptyCorpus?: boolean } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'he-sealed-root-')));
  const root = join(base, 'root');
  mkdirSync(join(root, 'tasks', 'multiuser', 'set1', 'heldout', 't1'), { recursive: true });
  mkdirSync(join(root, 'world'), { recursive: true });
  mkdirSync(join(root, 'corpus', 'heldout'), { recursive: true });
  writeFileSync(join(root, 'tasks', 'multiuser', 'set1', 'heldout', 't1', 'task.md'), 'synthetic sealed task\n');
  writeFileSync(join(root, 'world', 'slice.json'), JSON.stringify({ slice: 'synthetic' }) + '\n');
  writeFileSync(join(root, 'world', 'world.json'), JSON.stringify({ world: 'synthetic sealed world', nonce: randomBytes(8).toString('hex') }) + '\n');
  if (!opts.emptyCorpus) {
    writeFileSync(join(root, 'corpus', 'heldout', 'b-page.md'), '# B\nsynthetic sealed page\n');
    writeFileSync(join(root, 'corpus', 'heldout', 'a-page.md'), '# A\nsynthetic sealed page\n');
  }
  const world = sha256(readFileSync(join(root, 'world', 'world.json')));
  const corpus = execFileSync('bash', ['-c', "cd \"$1\" && find . -type f -printf '%P\\n' | LC_ALL=C sort | xargs -r -d '\\n' sha256sum | sha256sum | cut -d' ' -f1", 'digest', join(root, 'corpus')], { encoding: 'utf8' }).trim();
  writeFileSync(join(root, 'opening-receipt.json'), JSON.stringify({ run_id: 'sealed-test', world_sha256: opts.worldDigest ?? world, heldout_corpus_sha256: opts.corpusDigest ?? corpus }) + '\n');
  const receipt = join(base, 'opening-receipt.json');
  copyFileSync(join(root, 'opening-receipt.json'), receipt);
  return { base, root, receipt, world, corpus };
}

// A one-commit throwaway repository holding the lane scripts (scripts/ubicloud/run-shard.sh clones its own root).
function laneRepo(dir: string) {
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'scripts', 'ubicloud'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
  for (const f of ['run-shard.sh', 'bootstrap.sh', 'vm-shard.sh', 'smoke-lease.ts']) copyFileSync(join(ROOT, 'scripts', 'ubicloud', f), join(repo, 'scripts', 'ubicloud', f));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'lane scripts');
  return repo;
}

const SHARD_CANARY = 'CANARY turn 1 of sx-01-vault-ask in #syn-vault';
const UPLOAD_CANARY = 'tasks/multiuser/set1/heldout/sx-02-dm-guard/task.toml';

describe('ubicloud/run-shard.sh sealed upload and cleanup', () => {
  function lane(args: string[], opts: { exit?: number; identity?: string; downFails?: boolean; unpackFails?: boolean; prepare?: (dir: string) => void; dest?: (dir: string, repo: string) => string; unset?: string[] } = {}) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'he-sealed-lane-')));
    const store = join(dir, 'uploads');
    mkdirSync(store);
    const calls = join(dir, 'calls.log');
    fake(dir, 'ubi-runner.sh', [
      'cmd=$1; shift',
      'printf "%s\\n" "$cmd $*" >> "' + calls + '"',
      'case "$cmd" in',
      '  up) echo vm1 ;;',
      ...(opts.downFails ? ['  down) echo "down failed" >&2; exit 1 ;;'] : []),
      '  owner) echo fake-owner ;;',
      ...(opts.unpackFails ? ['  unpack) cat > /dev/null; echo "tar: ' + UPLOAD_CANARY + ': Cannot open: No space left on device" >&2; exit 2 ;;'] : []),
      '  unpack) cat > "' + store + '/unpack-$(printf %s "$2" | tr / _).tgz" ;;',
      '  ssh) shift; c=$1; case "$c" in',
      '    "cat > "*) cat > "' + store + '/$(basename "$' + '{c#cat > }")" ;;',
      '    *"cat > ~/.ubirun-env"*) cat > "' + store + '/ubirun-env" ;;',
      '    *"cat > ~/sealed/opening-receipt.json"*) cat > "' + store + '/sealed-opening-receipt.json" ;;',
      '    *"cat ~/shard/exit"*) cat > /dev/null; echo ' + (opts.exit ?? 0) + '; echo "::trials 0" ;;',
      '    *"tail -c +"*"run-shard.log"*) cat > /dev/null; echo "' + SHARD_CANARY + '" ;;',
      '    *) cat > /dev/null ;;',
      '  esac ;;',
      '  *) cat > /dev/null 2>&1 < /dev/null || true ;;',
      'esac',
    ].join('\n'));
    const repo = laneRepo(dir);
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'lane-test', cells: CELLS }));
    opts.prepare?.(dir);
    const dest = opts.dest ? opts.dest(dir, repo) : join(dir, 'dest');
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: dir,
      UBI_RUNNER: join(dir, 'ubi-runner.sh'),
      UBI_RUNNER_STATE: join(dir, 'state'),
      UBI_OWNER: 'test-owner',
      UBICLOUD_API_KEY: PLACEHOLDER,
      ANTHROPIC_API_KEY: PLACEHOLDER,
      OPENAI_API_KEY: PLACEHOLDER,
    };
    if (opts.identity) env.AGE_IDENTITY_IN_ENV = opts.identity;
    for (const k of opts.unset ?? []) delete env[k];
    const base = args.includes('--attach')
      ? ['--dest', dest, '--poll-seconds', '1']
      : ['--commit', 'HEAD', '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'sonnet', '--lease-usd', '7', '--dest', dest, '--poll-seconds', '1'];
    const r = spawnSync('bash', [join(repo, 'scripts', 'ubicloud', 'run-shard.sh'), ...base, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env });
    const read = (f: string) => (existsSync(join(store, f)) ? readFileSync(join(store, f), 'utf8') : '');
    const log = existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
    const tarFiles: Record<string, string> = {};
    const tgz = join(store, 'unpack-sealed_root.tgz');
    if (existsSync(tgz)) {
      const x = join(dir, 'untar');
      mkdirSync(x);
      execFileSync('tar', ['-xzf', tgz, '-C', x]);
      const walk = (rel: string) => {
        for (const e of readdirSync(join(x, rel), { withFileTypes: true })) {
          const p = rel ? rel + '/' + e.name : e.name;
          if (e.isDirectory()) walk(p);
          else tarFiles[p] = readFileSync(join(x, p), 'utf8');
        }
      };
      walk('');
    }
    const laneLog = existsSync(join(dest, 'lane.log')) ? readFileSync(join(dest, 'lane.log'), 'utf8') : '';
    const shardVm = existsSync(join(dest, 'shard-vm.json')) ? JSON.parse(readFileSync(join(dest, 'shard-vm.json'), 'utf8')) : {};
    const pending = existsSync(join(dest, 'cleanup-pending')) ? readFileSync(join(dest, 'cleanup-pending'), 'utf8') : '';
    const uploadLog = existsSync(join(dest, 'sealed-upload.log')) ? readFileSync(join(dest, 'sealed-upload.log'), 'utf8') : '';
    const result = { code: r.status, err: r.stderr, log, launch: read('launch.sh'), keyFile: read('ubirun-env'), receipt: read('sealed-opening-receipt.json'), tarFiles, laneLog, uploadLog, shardVm, pending, uploads: readdirSync(store) };
    rmSync(dir, { recursive: true, force: true });
    return result;
  }
  const at = (log: string[], needle: string) => log.findIndex((l) => l.includes(needle));

  test('the root goes to ~/sealed/root and the receipt to ~/sealed/opening-receipt.json, vm-shard.sh gets the VM paths, and ~/sealed is deleted before the VM', () => {
    const s = sealedRoot();
    try {
      const identity = 'AGE-SECRET-KEY-1FAKE' + randomBytes(16).toString('hex').toUpperCase();
      const r = lane(['--sealed-root', s.root, '--opening-receipt', s.receipt], { identity });
      expect(r.code).toBe(0);
      expect(at(r.log, 'unpack vm1 sealed/root')).toBeGreaterThan(at(r.log, 'sync vm1'));
      expect(at(r.log, 'unpack vm1 sealed/root')).toBeLessThan(at(r.log, 'bash ~/shard/bin/launch.sh'));
      const want = ['corpus/heldout/a-page.md', 'corpus/heldout/b-page.md', 'opening-receipt.json', 'tasks/multiuser/set1/heldout/t1/task.md', 'world/slice.json', 'world/world.json'];
      expect(Object.keys(r.tarFiles).sort()).toEqual(want);
      for (const f of want) expect(r.tarFiles[f]).toBe(readFileSync(join(s.root, f), 'utf8'));
      expect(r.receipt).toBe(readFileSync(s.receipt, 'utf8'));
      expect(r.launch).toContain(VM_FLAGS);
      expect(r.shardVm.sealed).toBe(true);
      const rm = at(r.log, 'ssh vm1 rm -rf ~/sealed');
      expect(rm).toBeGreaterThan(at(r.log, 'pull vm1 shard/results'));
      expect(rm).toBeLessThan(at(r.log, 'down vm1'));
      expect(r.laneLog).toContain('sealed: uploading ' + s.root + ' to ~/sealed/root and ' + s.receipt + ' (sha256 ' + sha256(readFileSync(s.receipt)) + ')');
      expect(r.laneLog).toContain('sealed: deleting ~/sealed');
      expect(r.keyFile).toContain('export ANTHROPIC_API_KEY=');
      expect(r.keyFile).not.toContain(identity);
      expect(r.keyFile).not.toContain('AGE_IDENTITY_IN_ENV');
      expect(r.keyFile).not.toContain('AGE-SECRET-KEY');
      expect(r.err).not.toContain(identity);
      expect(r.laneLog).not.toContain(identity);
      // the poll line of a sealed lane carries the count, never the shard log's last line
      expect(r.laneLog).toContain('poll: 0 trial lines');
      expect(r.laneLog).not.toContain(SHARD_CANARY);
      expect(r.err).not.toContain(SHARD_CANARY);
      // the destroy is recorded once down succeeded
      expect(r.shardVm.cleanup).toBe('done');
      expect(typeof r.shardVm.destroyed_at).toBe('string');
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  }, 60_000);

  // Value: protects=a shard launched with only ANTHROPIC_API_KEY set (no --embedded, so OPENAI_API_KEY is optional) writes the
  // key file and starts vm-shard.sh; fails_when=the key loop's last test returns nonzero under set -e and pipefail, which killed
  // the controller silently after the sealed upload (internal-task, 2026-10-29, a real VM); seam=the fake ubi-runner.sh above.
  test('a shard with OPENAI_API_KEY unset still writes the key file and launches vm-shard.sh', () => {
    const s = sealedRoot();
    try {
      const r = lane(['--sealed-root', s.root, '--opening-receipt', s.receipt], { unset: ['OPENAI_API_KEY'] });
      expect(r.code, r.err).toBe(0);
      expect(r.keyFile).toBe("export ANTHROPIC_API_KEY=" + PLACEHOLDER + "\n");
      expect(at(r.log, 'bash ~/shard/bin/launch.sh')).toBeGreaterThan(at(r.log, 'unpack vm1 sealed/root'));
      expect(r.launch).toContain(VM_FLAGS);
      expect(r.shardVm.cleanup).toBe('done');
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  }, 60_000);

  // Value: protects=a shard started without ANTHROPIC_API_KEY (alone, or with OPENAI_API_KEY also unset) is refused with
  // exit 2 before any VM exists, so the now-tolerant key loop never writes an empty or OpenAI-only key file to a VM;
  // fails_when=the ANTHROPIC_API_KEY guard is removed, weakened, or moved after ubi-runner.sh up; why_new=no test ran the
  // controller without ANTHROPIC_API_KEY; seam=none; no_claim=what a VM run would do with no Anthropic key.
  test('a shard with ANTHROPIC_API_KEY unset, alone or with OPENAI_API_KEY, is exit 2 before any VM or key file', () => {
    for (const unset of [['ANTHROPIC_API_KEY'], ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']]) {
      const r = lane([], { unset });
      expect(r.code, r.err).toBe(2);
      expect(r.err).toContain('run-shard (ubicloud): ANTHROPIC_API_KEY is not set in this shell; the metering proxy on the VM needs it');
      expect(r.log.filter((l) => l.startsWith('up '))).toEqual([]);
      expect(r.keyFile).toBe('');
      expect(r.uploads).toEqual([]);
    }
  }, 60_000);

  // Value: protects=an --embedded shard without OPENAI_API_KEY is refused with exit 2 before any VM exists; fails_when=the
  // --embedded guard is dropped, which would let the key loop (which now skips an unset key silently) launch an embedded run
  // with no OpenAI key; why_new=since the loop fix that guard is the only check of OPENAI_API_KEY for --embedded and no test
  // ran it; seam=none; no_claim=the sealed lane, which refuses --embedded on its own.
  test('an --embedded shard with OPENAI_API_KEY unset is exit 2 before any VM', () => {
    const r = lane(['--embedded'], { unset: ['OPENAI_API_KEY'] });
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain('run-shard (ubicloud): --embedded needs OPENAI_API_KEY in this shell');
    expect(r.log.filter((l) => l.startsWith('up '))).toEqual([]);
    expect(r.keyFile).toBe('');
  }, 60_000);

  // Value: protects=the launch.sh the controller writes reads a one-key ~/.ubirun-env into its shell, deletes the file
  // before vm-shard.sh starts, and starts vm-shard.sh with ANTHROPIC_API_KEY set and OPENAI_API_KEY unset; fails_when=the
  // source and rm lines are reordered or dropped, or a one-key file no longer launches; why_new=every lane test captured
  // launch.sh but none executed it; seam=none; no_claim=real ssh, the remote "key file deleted" check, the metering proxy, or
  // the VM's login profile (vm-shard.sh runs with --noprofile --norc here, so no host profile can put a real key in the test).
  test('the launcher reads a one-key ~/.ubirun-env, deletes it, then starts vm-shard.sh with only that key', async () => {
    const r = lane([], { unset: ['OPENAI_API_KEY'] });
    expect(r.code, r.err).toBe(0);
    expect(r.keyFile).toBe('export ANTHROPIC_API_KEY=' + PLACEHOLDER + '\n');
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'he-launcher-')));
    const bin = join(home, 'shard', 'bin');
    const saw = join(home, 'shard', 'saw');
    try {
      mkdirSync(bin, { recursive: true });
      const launch = r.launch.replace(' bash -l ', ' bash --noprofile --norc -l ');
      expect(r.launch.split(' bash -l ').length).toBe(2);
      expect(launch).not.toContain('bash -l');
      expect(launch.indexOf('. ~/.ubirun-env')).toBeLessThan(launch.indexOf('rm -f ~/.ubirun-env'));
      expect(launch.indexOf('rm -f ~/.ubirun-env')).toBeLessThan(launch.indexOf('setsid nohup'));
      writeFileSync(join(bin, 'launch.sh'), launch);
      writeFileSync(join(home, '.ubirun-env'), r.keyFile, { mode: 0o600 });
      const keys = [
        'if [ "$ANTHROPIC_API_KEY" = ' + PLACEHOLDER + ' ]; then echo anthropic=placeholder; elif [ -n "$ANTHROPIC_API_KEY" ]; then echo anthropic=other; else echo anthropic=unset; fi',
        'if [ -n "$OPENAI_API_KEY" ]; then echo openai=set; else echo openai=unset; fi',
      ].join('\n');
      fake(bin, 'vm-shard.sh', ['{ if [ -e "$HOME/.ubirun-env" ]; then echo keyfile=present; else echo keyfile=absent; fi', keys + '; } > "$HOME/shard/saw.tmp"', 'mv "$HOME/shard/saw.tmp" "$HOME/shard/saw"'].join('\n'));
      const env = { PATH: process.env.PATH ?? '', HOME: home };
      const l = spawnSync('bash', [join(bin, 'launch.sh')], { encoding: 'utf8', timeout: 20_000, env });
      expect(l.status, l.stderr).toBe(0);
      expect(l.stdout).toMatch(/^launched pid \d+$/m);
      expect(existsSync(join(home, '.ubirun-env'))).toBe(false);
      const deadline = Date.now() + 15_000;
      while (!existsSync(saw) && Date.now() < deadline) await Bun.sleep(50);
      expect(existsSync(saw)).toBe(true);
      expect(readFileSync(saw, 'utf8')).toBe('keyfile=absent\nanthropic=placeholder\nopenai=unset\n');
    } finally {
      const pidFile = join(home, 'shard', 'pid');
      const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : 0;
      if (pid > 0) { try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ } }
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  test('a failed down is not recorded as a destroy: the VM id goes to cleanup-pending and shard-vm.json says cleanup failed', () => {
    const s = sealedRoot();
    try {
      const r = lane(['--sealed-root', s.root, '--opening-receipt', s.receipt], { downFails: true });
      expect(at(r.log, 'down vm1')).toBeGreaterThan(-1);
      expect(r.shardVm.cleanup).toBe('failed');
      expect(r.shardVm.destroyed_at).toBeUndefined();
      expect(r.pending).toBe('vm1\n');
      expect(r.laneLog).toContain('WARNING: down vm1 failed');
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  }, 60_000);

  test('a run that exits non-zero still deletes ~/sealed, and --resume uploads the root again to its fresh VM', () => {
    const s = sealedRoot();
    try {
      const failed = lane(['--sealed-root', s.root, '--opening-receipt', s.receipt], { exit: 3 });
      expect(failed.code).toBe(3);
      expect(at(failed.log, 'ssh vm1 rm -rf ~/sealed')).toBeGreaterThan(-1);
      expect(at(failed.log, 'ssh vm1 rm -rf ~/sealed')).toBeLessThan(at(failed.log, 'down vm1'));

      const resumed = lane(['--sealed-root', s.root, '--opening-receipt', s.receipt, '--resume'], {
        prepare: (dir) => { mkdirSync(join(dir, 'dest', 'results'), { recursive: true }); writeFileSync(join(dir, 'dest', 'results', 'shard.json'), '{}\n'); },
      });
      expect(resumed.code).toBe(0);
      expect(at(resumed.log, 'unpack vm1 shard')).toBeGreaterThan(-1);
      expect(at(resumed.log, 'unpack vm1 sealed/root')).toBeGreaterThan(-1);
      expect(Object.keys(resumed.tarFiles)).toContain('world/world.json');
      expect(resumed.receipt).toBe(readFileSync(s.receipt, 'utf8'));
      expect(resumed.launch).toContain('--resume');
      expect(resumed.launch).toContain(VM_FLAGS);
      expect(at(resumed.log, 'ssh vm1 rm -rf ~/sealed')).toBeGreaterThan(-1);
      expect(at(resumed.log, 'ssh vm1 rm -rf ~/sealed')).toBeLessThan(at(resumed.log, 'down vm1'));
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  }, 60_000);

  test('a failed sealed upload prints a fixed line naming its log; tar and unpack diagnostics go to sealed-upload.log only, never the lane log', () => {
    const s = sealedRoot();
    try {
      const r = lane(['--sealed-root', s.root, '--opening-receipt', s.receipt], { unpackFails: true });
      expect(r.code).toBe(3);
      expect(r.err).toContain('sealed upload failed; its diagnostics are in ');
      expect(r.err).toContain('/sealed-upload.log (custody only)');
      expect(r.err).not.toContain(UPLOAD_CANARY);
      expect(r.laneLog).not.toContain(UPLOAD_CANARY);
      expect(r.uploadLog).toContain(UPLOAD_CANARY);
      expect(at(r.log, 'bash ~/shard/bin/launch.sh')).toBe(-1);
      expect(at(r.log, 'ssh vm1 rm -rf ~/sealed')).toBeLessThan(at(r.log, 'down vm1'));
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  }, 60_000);

  test('--attach reads sealed from shard-vm.json and deletes ~/sealed; an unsealed attach does not', () => {
    const vmJson = (sealed: boolean) => (dir: string) => {
      mkdirSync(join(dir, 'dest'), { recursive: true });
      writeFileSync(join(dir, 'dest', 'shard-vm.json'), JSON.stringify({ vm: 'vm1', size: 'standard-16', name: 's1', sealed }));
    };
    const sealed = lane(['--attach'], { prepare: vmJson(true) });
    expect(sealed.code).toBe(0);
    expect(at(sealed.log, 'ssh vm1 rm -rf ~/sealed')).toBeGreaterThan(at(sealed.log, 'pull vm1 shard/results'));
    expect(at(sealed.log, 'ssh vm1 rm -rf ~/sealed')).toBeLessThan(at(sealed.log, 'down vm1'));
    expect(sealed.laneLog).not.toContain(SHARD_CANARY);
    expect(sealed.err).not.toContain(SHARD_CANARY);
    const plain = lane(['--attach'], { prepare: vmJson(false) });
    // an unsealed lane keeps the last shard-log line in its poll line, so the sealed check above is not vacuous
    expect(plain.laneLog).toContain(SHARD_CANARY);
    expect(plain.code).toBe(0);
    expect(at(plain.log, 'rm -rf ~/sealed')).toBe(-1);
    expect(at(plain.log, 'down vm1')).toBeGreaterThan(-1);
  }, 60_000);

  test('without the flags nothing sealed is uploaded or deleted', () => {
    const r = lane([]);
    expect(r.code).toBe(0);
    expect(at(r.log, 'sealed/root')).toBe(-1);
    expect(at(r.log, '~/sealed')).toBe(-1);
    expect(r.uploads).not.toContain('unpack-sealed_root.tgz');
    expect(r.launch).not.toContain('--sealed-root');
    expect(r.launch).not.toContain('--opening-receipt');
    expect(r.shardVm.sealed).toBe(false);
  }, 60_000);

  test('a sealed --attach whose dest is inside a git work tree is refused before it polls, appends a log or pulls; an unsealed one is not', () => {
    const vmJson = (sealed: boolean) => (dir: string) => {
      mkdirSync(join(dir, 'repo', 'out', 'shard'), { recursive: true });
      writeFileSync(join(dir, 'repo', 'out', 'shard', 'shard-vm.json'), JSON.stringify({ vm: 'vm1', size: 'standard-16', name: 's1', sealed }));
    };
    const inCheckout = (_dir: string, repo: string) => join(repo, 'out', 'shard');
    const sealed = lane(['--attach'], { prepare: vmJson(true), dest: inCheckout });
    expect(sealed.code).toBe(2);
    expect(sealed.err).toMatch(/^HE-SEALED-002 run-shard \(ubicloud\): --dest \S+\/repo\/out\/shard is inside a git work tree and vm1 runs a sealed shard/);
    expect(sealed.err).toContain('vm1 is still running');
    expect(sealed.log).toEqual([]);
    expect(sealed.laneLog).toBe('');
    expect(sealed.err).not.toContain(SHARD_CANARY);
    const plain = lane(['--attach'], { prepare: vmJson(false), dest: inCheckout });
    expect(plain.code).toBe(0);
    expect(at(plain.log, 'down vm1')).toBeGreaterThan(-1);
  }, 60_000);

  test('a dest inside a git work tree, half the pair, or a missing path is refused before any VM', () => {
    const s = sealedRoot();
    try {
      const inside = lane(['--sealed-root', s.root, '--opening-receipt', s.receipt], { dest: (_dir, repo) => join(repo, 'out', 'shard') });
      expect(inside.code).toBe(2);
      expect(inside.err).toMatch(/^HE-SEALED-002 .*is inside a git work tree/);
      expect(inside.log).toEqual([]);
      const half = lane(['--sealed-root', s.root]);
      expect(half.code).toBe(2);
      expect(half.err).toContain('give both or neither');
      expect(half.log).toEqual([]);
      const missing = lane(['--sealed-root', s.root, '--opening-receipt', join(s.base, 'nope.json')]);
      expect(missing.code).toBe(2);
      expect(missing.err).toContain('does not exist');
      expect(missing.log).toEqual([]);
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('fanout.sh sealed manifest', () => {
  function dry(extra: Record<string, unknown>) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'he-sealed-fanout-')));
    try {
      fake(dir, 'ubi-runner.sh', 'echo "total 0 0"');
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
        commit: COMMIT, prereg: 'prereg.json', dest: join(dir, 'dest'), options: ['--gbrain-image', 'harness-eval/gbrain:dev', '--', '--max-output-tokens', '64000'],
        shards: [{ name: 'a', cells: 'c1', lease_usd: 1 }, { name: 'b', cells: 'c2', lease_usd: 2 }], ...extra,
      }));
      const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'fanout.sh'), '--manifest', join(dir, 'manifest.json'), '--dry-run'], {
        encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH ?? '', HOME: dir, UBI_OWNER: 'test-owner', UBI_RUNNER: join(dir, 'ubi-runner.sh') },
      });
      return { code: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split('\n').filter((l) => l.includes('run-shard.sh ')) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('both fields put both flags on every run-shard.sh line, before the arguments after --', () => {
    const r = dry({ sealed_root: '/custody/root', opening_receipt: '/custody/opening-receipt.json' });
    expect(r.code).toBe(0);
    expect(r.lines).toHaveLength(2);
    for (const l of r.lines) expect(l).toContain('--size standard-16 --sealed-root /custody/root --opening-receipt /custody/opening-receipt.json --gbrain-image harness-eval/gbrain:dev -- --max-output-tokens 64000');
  });

  test('a home-relative path is expanded, one field alone is exit 2, and no fields means no flags', () => {
    const home = dry({ sealed_root: '~/custody/root', opening_receipt: '~/custody/r.json' });
    expect(home.code).toBe(0);
    expect(home.lines).toHaveLength(2);
    for (const l of home.lines) expect(l).toMatch(/--sealed-root \/\S+\/custody\/root --opening-receipt \/\S+\/custody\/r\.json /);
    const one = dry({ sealed_root: '/custody/root' });
    expect(one.code).toBe(2);
    expect(one.err).toContain('give both or neither');
    expect(one.lines).toEqual([]);
    const other = dry({ opening_receipt: '/custody/r.json' });
    expect(other.code).toBe(2);
    const none = dry({});
    expect(none.code).toBe(0);
    expect(none.out).not.toContain('--sealed-root');
    expect(none.out).not.toContain('--opening-receipt');
    for (const l of none.lines) expect(l).toContain('--size standard-16 --gbrain-image harness-eval/gbrain:dev -- --max-output-tokens 64000');
  });
});

describe('vm-shard.sh sealed flags', () => {
  function vmShard(args: string[]) {
    const home = mkdtempSync(join(tmpdir(), 'he-sealed-vm-shard-'));
    try {
      const checkout = join(home, 'work', 'harness-evals');
      mkdirSync(join(checkout, 'scripts'), { recursive: true });
      mkdirSync(join(checkout, 'tasks', 'multiuser', 'dev', 't1'), { recursive: true });
      const bin = join(home, 'fakebin');
      mkdirSync(bin);
      fake(bin, 'git', 'case "$1" in rev-parse) echo ' + COMMIT + ' ;; esac');
      fake(bin, 'bun', 'case "$1" in install) exit 0 ;; --version) echo 1.0.0 ;; *) echo "fake bun: $*" >&2; exit 9 ;; esac');
      fake(join(checkout, 'scripts'), 'run-shard.sh', 'echo "run-shard $*" >> "$HOME/calls.log"; out=""; while [ $# -gt 0 ]; do [ "$1" = --out ] && out=$2; shift; done; mkdir -p "$out"; echo \'{"trial_id":"t","termination":"completed"}\' > "$out/trials.jsonl"');
      writeFileSync(join(home, 'prereg.json'), JSON.stringify({ run_id: 'test', spend_cap_usd: 99, cells: CELLS }));
      const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh'), '--commit', COMMIT, '--prereg', join(home, 'prereg.json'), '--name', 's1', '--cells', 'sonnet', '--lease-usd', '7',
        '--smoke-lease-usd', '2', ...args], {
        cwd: ROOT, encoding: 'utf8', env: { PATH: bin + ':' + process.env.PATH, HOME: home, HE_SHARD_IN_DOCKER_GROUP: '1' },
      });
      return { code: r.status, calls: existsSync(join(home, 'calls.log')) ? readFileSync(join(home, 'calls.log'), 'utf8').split('\n').filter(Boolean) : [] };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  test('the smoke is a public dev run on the public image; the sealed flags and the sealed image reach the counted run only, which builds it', () => {
    const r = vmShard(['--sealed-root', VM_ROOT, '--opening-receipt', VM_RECEIPT, '--gbrain-image', 'harness-eval/gbrain:sealed-test', '--', '--max-output-tokens', '64000']);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(2);
    const [smoke, counted] = r.calls as [string, string];
    expect(smoke).toContain('--name smoke-s1 ');
    expect(smoke).toContain('--gbrain-image harness-eval/gbrain:dev --max-output-tokens 64000');
    expect(smoke).not.toContain('--sealed-root');
    expect(smoke).not.toContain('--opening-receipt');
    expect(smoke).not.toContain('gbrain:sealed-');
    expect(counted).toContain('--name s1 ');
    expect(counted).toContain('--gbrain-image harness-eval/gbrain:sealed-test ' + VM_FLAGS + ' --max-output-tokens 64000');
    expect(counted).not.toContain('--skip-build');
  }, 30_000);

  test('an unsealed lane forwards its image to both calls and skips the counted build after the smoke, as before', () => {
    const r = vmShard(['--gbrain-image', 'harness-eval/gbrain:dev', '--', '--max-output-tokens', '64000']);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(2);
    const [smoke, counted] = r.calls as [string, string];
    expect(smoke).toContain('--name smoke-s1 ');
    expect(smoke).toContain('--gbrain-image harness-eval/gbrain:dev --max-output-tokens 64000');
    expect(counted).toContain('--skip-build --gbrain-image harness-eval/gbrain:dev --max-output-tokens 64000');
    for (const c of r.calls) expect(c).not.toContain('--sealed-root');
  }, 30_000);
});

describe('scripts/run-shard.sh sealed refusals', () => {
  function shard(args: string[]) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'he-sealed-run-shard-')));
    try {
      const repo = laneRepo(dir);
      const bin = join(dir, 'fakebin');
      mkdirSync(bin);
      fake(bin, 'docker', 'echo "docker $*" >> "' + join(dir, 'docker.log') + '"; exit 1');
      writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'shard-test', cells: CELLS }));
      const r = spawnSync('bash', [join(repo, 'scripts', 'run-shard.sh'), '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'sonnet', '--lease-usd', '1', ...args], {
        cwd: repo, encoding: 'utf8', timeout: 30_000, env: { PATH: bin + ':' + process.env.PATH, HOME: dir },
      });
      return { code: r.status, err: r.stderr, docker: existsSync(join(dir, 'docker.log')) ? readFileSync(join(dir, 'docker.log'), 'utf8') : '' };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('--sealed-root without --opening-receipt (and the reverse) is exit 2', () => {
    const s = sealedRoot();
    try {
      const a = shard(['--sealed-root', s.root, '--out', join(s.base, 'out')]);
      expect(a.code).toBe(2);
      expect(a.err).toContain('give both or neither');
      const b = shard(['--opening-receipt', s.receipt, '--out', join(s.base, 'out')]);
      expect(b.code).toBe(2);
      expect(b.err).toContain('give both or neither');
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  });

  test('both flags with the default out, an --out inside the checkout, or --embedded are exit 2 before any build', () => {
    const s = sealedRoot();
    try {
      const sealed = ['--sealed-root', s.root, '--opening-receipt', s.receipt];
      const dflt = shard(sealed);
      expect(dflt.code).toBe(2);
      expect(dflt.err).toContain('needs --out outside the checkout');
      expect(dflt.docker).toBe('');
      const inside = shard([...sealed, '--out', 'results/shard-test']);
      expect(inside.code).toBe(2);
      expect(inside.err).toMatch(/^HE-SEALED-002 run-shard: --out \S+ is inside the checkout/);
      expect(inside.docker).toBe('');
      // another git checkout is refused the same way, before the out directory, the copy or any log exists
      const other = join(s.base, 'other-checkout');
      mkdirSync(other);
      execFileSync('git', ['init', '-q'], { cwd: other });
      const elsewhere = shard([...sealed, '--out', join(other, 'results', 'shard-test')]);
      expect(elsewhere.code).toBe(2);
      expect(elsewhere.err).toMatch(/^HE-SEALED-002 run-shard: --out \S+\/other-checkout\/results\/shard-test is inside a git work tree/);
      expect(elsewhere.docker).toBe('');
      expect(existsSync(join(other, 'results'))).toBe(false);
      const embedded = shard([...sealed, '--out', join(s.base, 'out'), '--embedded']);
      expect(embedded.code).toBe(2);
      expect(embedded.err).toContain('--embedded is not supported for sealed sets');
      expect(embedded.docker).toBe('');
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  }, 60_000);
});

// Value: protects=a local sealed shard (scripts/run-shard.sh) builds, plans, preflights and runs from its own copy of the
// custodian's root (mode 0700, under TMPDIR), removes the copy on success and on a failed run or build, keeps the copy's
// build log under <out>/sealed-root-logs/, and never writes the custodian's root; fails_when=a step reads the custodian's
// root directly, a copy survives an exit, or the root is changed by the shard; why_new=the shard copy is new (outside
// review H4); seam=fake docker, bun and build-gbrain-image.sh that record the root they were given; no_claim=the real
// runner and image build (tests/sealed-output.test.ts runs the real runner through run-shard.sh).
describe('scripts/run-shard.sh sealed shard copy of the root', () => {
  const snapshot = (root: string) => {
    const files: Record<string, string> = {};
    const walk = (rel: string) => {
      for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
        const p = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) walk(p);
        else files[p] = readFileSync(join(root, p), 'utf8');
      }
    };
    walk('');
    return files;
  };
  function shard(s: ReturnType<typeof sealedRoot>, opts: { runExit?: number; buildExit?: number } = {}) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'he-sealed-shard-copy-')));
    try {
      const repo = laneRepo(dir);
      const seen = join(dir, 'seen.log');
      const record = 'echo "$step $root $(stat -c %a "$root") $(sha256sum "$root/world/world.json" | cut -d\' \' -f1)" >> "$SEEN"';
      fake(join(repo, 'scripts'), 'build-gbrain-image.sh', ['step=build; root=""', 'while [ $# -gt 0 ]; do [ "$1" = --sealed-root ] && root=$2; shift; done', record,
        'mkdir -p "$root/logs" && echo "synthetic sealed build log" > "$root/logs/build-gbrain-image.log"', 'exit "${BUILD_EXIT:-0}"'].join('\n'));
      execFileSync('git', ['add', '.'], { cwd: repo });
      execFileSync('git', ['commit', '-q', '-m', 'fake build'], { cwd: repo });
      const bin = join(dir, 'fakebin');
      mkdirSync(bin);
      fake(bin, 'docker', 'case "$1" in image) echo "sha256:0000" ;; *) exit 0 ;; esac');
      fake(bin, 'bun', ['step=$2; root=""; out=""; manifest=""', 'while [ $# -gt 0 ]; do case "$1" in --sealed-root) root=$2 ;; --out) out=$2 ;; --manifest) manifest=$2 ;; esac; shift; done', record,
        'case "$step" in', '  plan) mkdir -p "$out" && echo "{}" > "$out/manifest.json" ;;', '  preflight) echo "PREFLIGHT: ok" ;;',
        '  run) echo \'{"trial_id":"t"}\' >> "$(dirname "$manifest")/trials.jsonl"; exit "${RUN_EXIT:-0}" ;;', 'esac'].join('\n'));
      const tmp = join(dir, 'tmp');
      mkdirSync(tmp);
      writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'shard-copy-test', cells: CELLS }));
      const out = join(dir, 'out'), printed = join(dir, 'run-shard.out');
      // the prune loop leaves a sleep holding the script's stdout, so the output goes through a file rather than a pipe
      const r = spawnSync('bash', ['-c', 'bash "$1" "${@:2}" > "$0" 2>&1', printed, join(repo, 'scripts', 'run-shard.sh'), '--prereg', join(dir, 'prereg.json'), '--name', 's1', '--cells', 'sonnet', '--lease-usd', '1',
        '--out', out, '--sealed-root', s.root, '--opening-receipt', s.receipt], {
        cwd: repo, encoding: 'utf8', timeout: 60_000,
        env: { PATH: bin + ':' + process.env.PATH, HOME: dir, TMPDIR: tmp, SEEN: seen, RUN_EXIT: String(opts.runExit ?? 0), BUILD_EXIT: String(opts.buildExit ?? 0) },
      });
      const steps = existsSync(seen) ? readFileSync(seen, 'utf8').split('\n').filter(Boolean).map((l) => { const [step, root, mode, world] = l.split(' '); return { step, root, mode, world }; }) : [];
      const keptLog = join(out, 'sealed-root-logs', 'build-gbrain-image.log');
      const copyPath = join(out, 'sealed-root-copy.path');
      return { code: r.status, out: readFileSync(printed, 'utf8'), steps, tmpLeft: readdirSync(tmp), copiesLeft: steps.filter((x) => existsSync(x.root!)).length, keptLog: existsSync(keptLog) ? readFileSync(keptLog, 'utf8') : '', copyPath: existsSync(copyPath) ? readFileSync(copyPath, 'utf8') : '', tmp };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('every step reads one private copy under TMPDIR, the copy is gone after success, and the custodian\'s root is untouched', () => {
    const s = sealedRoot();
    try {
      const before = snapshot(s.root);
      const r = shard(s);
      expect(r.code, r.out).toBe(0);
      expect(r.steps.map((x) => x.step)).toEqual(['build', 'plan', 'preflight', 'run']);
      const copy = r.steps[0]!.root!;
      expect(copy).toMatch(new RegExp('^' + r.tmp + '/harness-eval-sealed-shard\.[A-Za-z0-9]+/root$'));
      for (const x of r.steps) {
        expect(x.root).toBe(copy);
        expect(x.mode).toBe('700');
        expect(x.world).toBe(s.world);
      }
      expect(r.out).toContain('sealed: this shard reads its own copy of the root at ' + copy);
      // the copy's directory is recorded for scripts/sealed/cleanup.ts, one line per launch
      expect(r.copyPath).toBe(copy.slice(0, -'/root'.length) + '\n');
      expect(r.copiesLeft).toBe(0);
      expect(r.tmpLeft).toEqual([]);
      expect(r.keptLog).toBe('synthetic sealed build log\n');
      expect(snapshot(s.root)).toEqual(before);
      expect(existsSync(join(s.root, 'logs'))).toBe(false);
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  }, 60_000);

  test('a failed run and a failed image build remove the copy too, and the root is untouched', () => {
    const s = sealedRoot();
    try {
      const before = snapshot(s.root);
      const failed = shard(s, { runExit: 3 });
      expect(failed.code).toBe(3);
      expect(failed.steps.map((x) => x.step)).toEqual(['build', 'plan', 'preflight', 'run']);
      expect(failed.copiesLeft).toBe(0);
      expect(failed.tmpLeft).toEqual([]);
      const build = shard(s, { buildExit: 1 });
      expect(build.code).toBe(2);
      expect(build.steps.map((x) => x.step)).toEqual(['build']);
      expect(build.out).toContain('gbrain image build failed');
      expect(build.out).toContain('sealed-root-logs/build-gbrain-image.log (custody only)');
      expect(build.out).not.toContain('synthetic sealed build log');
      expect(build.keptLog).toBe('synthetic sealed build log\n');
      expect(build.copiesLeft).toBe(0);
      expect(build.tmpLeft).toEqual([]);
      expect(snapshot(s.root)).toEqual(before);
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('build-gbrain-image.sh --sealed-root', () => {
  function build(args: string[]) {
    const out = mkdtempSync(join(tmpdir(), 'he-sealed-build-out-'));
    try {
      const r = spawnSync('bash', [join(ROOT, 'scripts', 'build-gbrain-image.sh'), '--dry-run', '--out', out, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
      return { code: r.status, out: r.stdout, err: r.stderr };
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }

  test('a root that matches its receipt puts the named contexts, both digests and the label on the keyword build line', () => {
    const s = sealedRoot();
    const empty = sealedRoot({ emptyCorpus: true });
    try {
      const r = build(['--sealed-root', s.root]);
      expect(r.code).toBe(0);
      const line = r.out.split('\n').find((l) => l.startsWith('keyword build:')) ?? '';
      expect(line).toContain('--build-context world-input=' + s.root + '/world');
      expect(line).toContain('--build-context heldout-corpus=' + s.root + '/corpus');
      expect(line).toContain('--build-arg SEALED_WORLD_SHA256=' + s.world);
      expect(line).toContain('--build-arg SEALED_CORPUS_SHA256=' + s.corpus);
      expect(line).toContain('--label harness-eval.sealed=true');
      expect(r.out).not.toContain('synthetic sealed');
      const e = build(['--sealed-root', empty.root]);
      expect(e.code).toBe(0);
      expect(empty.corpus).toBe(sha256(''));
      expect(e.out).toContain('--build-arg SEALED_CORPUS_SHA256=' + empty.corpus);
    } finally {
      rmSync(s.base, { recursive: true, force: true });
      rmSync(empty.base, { recursive: true, force: true });
    }
  });

  test('a receipt whose world or corpus digest differs is exit 2 under HE-SEALED-005', () => {
    const w = sealedRoot({ worldDigest: 'f'.repeat(64) });
    const c = sealedRoot({ corpusDigest: 'e'.repeat(64) });
    try {
      const rw = build(['--sealed-root', w.root]);
      expect(rw.code).toBe(2);
      expect(rw.err).toMatch(/^HE-SEALED-005 .*world\.json has sha256/m);
      const rc = build(['--sealed-root', c.root]);
      expect(rc.code).toBe(2);
      expect(rc.err).toMatch(/^HE-SEALED-005 .*corpus has digest/m);
    } finally {
      rmSync(w.base, { recursive: true, force: true });
      rmSync(c.base, { recursive: true, force: true });
    }
  });

  test('a root inside the checkout and --embedded are refused; without --sealed-root there is no build context', () => {
    const inside = build(['--sealed-root', join(ROOT, 'gbrain')]);
    expect(inside.code).toBe(2);
    expect(inside.err).toContain('is inside the checkout');
    const s = sealedRoot();
    try {
      const emb = build(['--sealed-root', s.root, '--embedded']);
      expect(emb.code).toBe(2);
      expect(emb.err).toContain('not supported for sealed sets yet');
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
    const plain = build([]);
    expect(plain.code).toBe(0);
    expect(plain.out).not.toContain('build-context');
    expect(plain.out).not.toContain('SEALED_');
    expect(plain.out).not.toContain('harness-eval.sealed');
  });
});

const dockerUp = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!dockerUp)('gbrain/Dockerfile named-context stages (docker)', () => {
  function exportStage(target: string, contexts: string[]) {
    const out = mkdtempSync(join(tmpdir(), 'he-sealed-stage-'));
    const r = spawnSync('docker', ['build', '-q', '--target', target, ...contexts, '-o', 'type=local,dest=' + out, '-f', join(ROOT, 'gbrain', 'Dockerfile'), ROOT], { encoding: 'utf8', timeout: 300_000 });
    return { code: r.status, err: r.stderr, out };
  }

  test('world-input is the named context when given and the repository world otherwise', () => {
    const s = sealedRoot();
    const a = exportStage('world-input', ['--build-context', 'world-input=' + s.root + '/world']);
    const b = exportStage('world-input', []);
    try {
      expect(a.code).toBe(0);
      expect(sha256(readFileSync(join(a.out, 'world.json')))).toBe(s.world);
      expect(b.code).toBe(0);
      expect(sha256(readFileSync(join(b.out, 'world.json')))).toBe(sha256(readFileSync(join(ROOT, 'world', 'seed', 'world.json'))));
    } finally {
      for (const d of [s.base, a.out, b.out]) rmSync(d, { recursive: true, force: true });
    }
  }, 300_000);

  test('heldout-corpus is empty by default and holds the sealed pages from the named context', () => {
    const s = sealedRoot();
    const a = exportStage('heldout-corpus', ['--build-context', 'heldout-corpus=' + s.root + '/corpus']);
    const b = exportStage('heldout-corpus', []);
    try {
      expect(a.code).toBe(0);
      expect(readdirSync(join(a.out, 'heldout')).sort()).toEqual(['a-page.md', 'b-page.md']);
      expect(b.code).toBe(0);
      expect(readdirSync(b.out)).toEqual([]);
    } finally {
      for (const d of [s.base, a.out, b.out]) rmSync(d, { recursive: true, force: true });
    }
  }, 300_000);
});

// Value: protects=--help of build-gbrain-image.sh and ubicloud/run-shard.sh prints the whole header, through its last
// comment line; fails_when=a fixed sed range falls behind a grown header (maintainability review, pass 4); seam=the scripts
// run with --help only; no_claim=the header's content.
describe('--help prints the whole header', () => {
  for (const f of ['scripts/build-gbrain-image.sh', 'scripts/ubicloud/run-shard.sh']) {
    test(f, () => {
      const src = readFileSync(join(ROOT, f), 'utf8').split('\n');
      const end = src.findIndex((l, i) => i > 0 && !l.startsWith('#'));
      const out = spawnSync('bash', [join(ROOT, f), '--help'], { encoding: 'utf8' }).stdout.trimEnd().split('\n');
      expect(out.at(-1)).toBe(src[end - 1]!);
      expect(out.length).toBe(end - 1);
    });
  }
});
