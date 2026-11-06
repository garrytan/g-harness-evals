// scripts/run-shard.sh and a task set with its own world (internal-task, the v0.4 fix lane): the gbrain cells of a dev split whose
// set carries tasks/multiuser/<task_set>/world/world.json read that world, so the shard builds their gbrain image with
// build-gbrain-image.sh --world and hands preflight the world tag the runner expects. Before the fix the shard built
// harness-eval/gbrain:dev without --world and passed that tag, which the runner refuses for those cells (HE-GBRAIN-002).
//
// Value: protects=the shard's gbrain build gets --world <set world> and the tag harness-eval/gbrain:world-<sha12>, preflight
// gets that tag, shard.json records it, an explicit --gbrain-image is kept, a shard with no set-world gbrain cell is
// unchanged, and gbrain cells on two worlds are refused before any build; fails_when=the --world flag or the tag is dropped;
// why_new=the shard never passed --world; seam=fake docker, bun and build-gbrain-image.sh on PATH in a throwaway clean
// checkout holding a copy of the script (as tests/run-shard-qm-sandbox.test.ts); no_claim=a real image build or the
// runner's own world checks (tests/v04-set-world.test.ts).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'run-shard-world-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const WORLD = JSON.stringify({ world: 'synthetic set world' }) + '\n';
const TAG = 'harness-eval/gbrain:world-' + createHash('sha256').update(WORLD).digest('hex').slice(0, 12);
const CELLS = [
  { id: 'w', harness: 'openclaw', split: 'dev', task_set: 'v0.4/rehearsal', gbrain: { surface: 'starter' } },
  { id: 'n', harness: 'openclaw', split: 'dev', task_set: 'v0.4/rehearsal' },
  { id: 'p', harness: 'openclaw', split: 'dev', task_set: 'v0.4', gbrain: { surface: 'starter' } },
  { id: 'h', harness: 'openclaw', split: 'heldout', task_set: 'v0.4/rehearsal', gbrain: { surface: 'starter' } },
];

function shard(cells: string, extra: string[] = []) {
  const dir = mkdtempSync(join(tmp, 'repo-'));
  const bin = join(dir, '.fake-bin');
  const logs = mkdtempSync(join(tmp, 'logs-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(bin);
  mkdirSync(join(dir, 'tasks', 'multiuser', 'v0.4', 'rehearsal', 'world'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'multiuser', 'v0.4', 'rehearsal', 'world', 'world.json'), WORLD);
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(dir, 'scripts', 'run-shard.sh'));
  const script = (path: string, body: string) => { writeFileSync(path, '#!/usr/bin/env bash\n' + body + '\n'); chmodSync(path, 0o755); };
  script(join(dir, 'scripts', 'build-gbrain-image.sh'), `echo "$*" >> '${logs}/build'`);
  script(join(bin, 'docker'), `if [ "$1 $2" = "image inspect" ]; then echo "sha256:id-${'$'}{@: -1}"; fi\nexit 0`);
  script(join(bin, 'bun'), `echo "$*" >> '${logs}/bun'\ncase " $* " in *" preflight "*) exit 1 ;; esac\nexit 0`);
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'set-world-test', cells: CELLS }));
  writeFileSync(join(dir, '.gitignore'), '.fake-bin/\nresults/\n');
  const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
  const p = spawnSync('bash', ['--noprofile', '--norc', join(dir, 'scripts', 'run-shard.sh'), '--prereg', 'prereg.json', '--name', 's', '--cells', cells, '--lease-usd', '1', ...extra],
    { cwd: dir, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: mkdtempSync(join(tmp, 'home-')) } });
  const read = (f: string) => (existsSync(join(logs, f)) ? readFileSync(join(logs, f), 'utf8') : '');
  const shardPath = join(dir, 'results', 'set-world-test', 'shard.json');
  const images = existsSync(shardPath) ? (JSON.parse(readFileSync(shardPath, 'utf8')) as { images: Record<string, string> }).images : undefined;
  return { status: p.status, stderr: p.stderr, build: read('build'), preflight: read('bun').split('\n').find((l) => l.includes(' preflight ')) ?? '', images };
}

describe('run-shard.sh and a task set with its own world', () => {
  test('a dev gbrain cell of a set with a world builds with --world and the world tag, and preflight gets that tag', () => {
    const r = shard('w,n');
    expect(r.build).toContain('--tag ' + TAG + ' ');
    expect(r.build).toContain('--world tasks/multiuser/v0.4/rehearsal/world/world.json');
    expect(r.preflight).toContain('--gbrain-image ' + TAG);
    expect(r.images?.[TAG]).toBe('sha256:id-' + TAG);
    expect(r.images?.['harness-eval/gbrain:dev']).toBeUndefined();
  }, 30_000);

  test('an explicit --gbrain-image is kept, still built from the set world', () => {
    const r = shard('w', ['--gbrain-image', 'custom/gbrain:x']);
    expect(r.build).toContain('--tag custom/gbrain:x ');
    expect(r.build).toContain('--world tasks/multiuser/v0.4/rehearsal/world/world.json');
    expect(r.preflight).toContain('--gbrain-image custom/gbrain:x');
  }, 30_000);

  test('gbrain cells of a set with no world, or held-out ones, keep harness-eval/gbrain:dev and no --world', () => {
    for (const cells of ['p', 'h', 'n']) {
      const r = shard(cells);
      expect(r.build).toContain('--tag harness-eval/gbrain:dev ');
      expect(r.build).not.toContain('--world');
      expect(r.preflight).toContain('--gbrain-image harness-eval/gbrain:dev');
    }
  }, 60_000);

  test('gbrain cells that read different worlds are refused before any build', () => {
    const r = shard('w,p');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('HE-GBRAIN-002');
    expect(r.build).toBe('');
  }, 30_000);
});
