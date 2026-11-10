// run-shard.sh's drive mirror at teardown, keyless, no VM: the qm-driver smoke's gstack checkout
// (smoke/work/gstack-edition, pulled back with shard/smoke) holds gstack's own test text, which is key-shaped, so the mirror
// leaves that checkout out; key-shaped text anywhere else still stops the mirror.
//
// Value: protects=each qm-driver shard's final copy reaches --replicate-to although its smoke's gstack checkout holds
// key-shaped test text, and the mirror never carries that checkout; key-shaped text in any other file, smoke results and
// other smoke work included, still keeps the previous mirror; fails_when=the final mirror is refused over the gstack
// checkout, the checkout is mirrored, or the scan stops catching key-shaped text elsewhere; seam=UBI_RUNNER with a fake
// ubi-runner.sh whose pull of shard/smoke writes the files, driven through --attach; no_claim=a real VM, ssh or tar stream.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
// Built at run time so this file holds no key-shaped literal.
const KEY_SHAPED = 'sk-' + 'ant-' + 'api03-' + 'x'.repeat(24);

function attachWithSmoke(smokeFiles: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'he-ubi-mirror-'));
  dirs.push(dir);
  const files = join(dir, 'smoke-files.json');
  writeFileSync(files, JSON.stringify(smokeFiles));
  const runner = join(dir, 'ubi-runner.sh');
  writeFileSync(runner, [
    '#!/usr/bin/env bash',
    'cmd=$1; shift',
    'case "$cmd" in',
    '  pull) case "$2" in',
    '    shard/results) mkdir -p "$3/results" && echo \'{"trial_id": "t"}\' > "$3/results/turns.jsonl" && echo \'{}\' > "$3/results/run.json" ;;',
    '    shard/smoke) python3 -c \'import json, os, sys; [os.makedirs(os.path.dirname(os.path.join(sys.argv[2], p)), exist_ok=True) or open(os.path.join(sys.argv[2], p), "w").write(t) for p, t in json.load(open(sys.argv[1])).items()]\' ' + JSON.stringify(files) + ' "$3" ;;',
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
  writeFileSync(join(dest, 'shard-vm.json'), JSON.stringify({ name: 'opus-b1', vm: 'vm1', size: 'standard-16', sealed: false, workload: 'qm-driver', cleanup: 'pending' }));
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, UBI_RUNNER: runner, UBI_RUNNER_STATE: join(dir, 'state'), UBI_OWNER: 'test-owner', UBICLOUD_API_KEY: 'placeholder-not-a-key' };
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'ubicloud', 'run-shard.sh'), '--attach', '--dest', dest, '--poll-seconds', '1', '--replicate-to', replica], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const laneLog = existsSync(join(dest, 'lane.log')) ? readFileSync(join(dest, 'lane.log'), 'utf8') : '';
  return { code: r.status, err: r.stderr, dest, mirror: join(replica, 'opus-b1'), laneLog };
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
