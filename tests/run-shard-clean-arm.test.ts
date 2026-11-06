// scripts/run-shard.sh --clean-arm-preflight (internal-task, v0.4 PR B; CREW.md "Clean no-gstack and no-brain arms"): before plan,
// the shard runs scripts/v04/clean-arm-audit.ts preflight with one --image per harness the shard's cells use and writes
// preflight-clean-arm.json; a finding (exit 1) or a probe that could not run (any other exit) stops the shard with exit 2
// before plan, each with its own message. Without the flag nothing changes.
//
// Value: protects=the flag runs the preflight per harness image before plan and stops the shard on a finding or a failed
// probe, and the default path never runs it; fails_when=the flag parse, the --image arguments, the exit-2 guard or the
// message split is dropped, or the default starts running it; why_new=no test passed the flag (#225's /ship coverage audit);
// seam=fake docker, bun and build-gbrain-image.sh on PATH in a throwaway clean checkout holding a copy of the script (as
// tests/run-shard-set-world.test.ts); no_claim=real image contents (tests/v04-clean-arm-audit.test.ts covers the audit).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'run-shard-clean-arm-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const CELLS = [
  { id: 'oc', harness: 'openclaw', split: 'dev', task_set: 'v0.4' },
  { id: 'he', harness: 'hermes', split: 'dev', task_set: 'v0.4' },
];

function shard(extra: string[], cleanRc: number) {
  const dir = mkdtempSync(join(tmp, 'repo-'));
  const bin = join(dir, '.fake-bin');
  const logs = mkdtempSync(join(tmp, 'logs-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(bin);
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(dir, 'scripts', 'run-shard.sh'));
  const script = (path: string, body: string) => { writeFileSync(path, '#!/usr/bin/env bash\n' + body + '\n'); chmodSync(path, 0o755); };
  script(join(dir, 'scripts', 'build-gbrain-image.sh'), 'exit 0');
  script(join(bin, 'docker'), `if [ "$1 $2" = "image inspect" ]; then echo "sha256:id-${'$'}{@: -1}"; fi\nexit 0`);
  script(join(bin, 'bun'), [
    `echo "$*" >> '${logs}/bun'`,
    `case " $* " in *" scripts/v04/clean-arm-audit.ts preflight "*) echo "clean-arm preflight: fake"; exit ${cleanRc} ;; *" preflight "*) exit 1 ;; esac`,
    'exit 0',
  ].join('\n'));
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'clean-arm-test', cells: CELLS }));
  writeFileSync(join(dir, '.gitignore'), '.fake-bin/\nresults/\n');
  const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
  const p = spawnSync('bash', ['--noprofile', '--norc', join(dir, 'scripts', 'run-shard.sh'), '--prereg', 'prereg.json', '--name', 's', '--cells', 'oc,he', '--lease-usd', '1', ...extra],
    { cwd: dir, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: mkdtempSync(join(tmp, 'home-')) } });
  const calls = (existsSync(join(logs, 'bun')) ? readFileSync(join(logs, 'bun'), 'utf8') : '').split('\n').filter(Boolean);
  return { status: p.status, stderr: p.stderr, clean: calls.filter((l) => l.includes('clean-arm-audit.ts')), plan: calls.filter((l) => l.startsWith('runner/run.ts plan')) };
}

describe('run-shard.sh --clean-arm-preflight', () => {
  test('without the flag no preflight runs and plan does', () => {
    const r = shard([], 1);
    expect(r.clean).toEqual([]);
    expect(r.plan).toHaveLength(1);
  }, 30_000);

  test('a clean preflight checks one image per harness, writes its file under --out, then plan runs', () => {
    const r = shard(['--clean-arm-preflight'], 0);
    expect(r.clean).toHaveLength(1);
    expect(r.clean[0]).toMatch(/^scripts\/v04\/clean-arm-audit\.ts preflight --out \S*results\/clean-arm-test\/preflight-clean-arm\.json /);
    expect(r.clean[0]).toContain('--image harness-eval/openclaw:dev');
    expect(r.clean[0]).toContain('--image harness-eval/hermes:dev');
    expect(r.plan).toHaveLength(1);
  }, 30_000);

  test('a finding stops the shard with exit 2 before plan, and a probe that could not run says so apart', () => {
    const found = shard(['--clean-arm-preflight'], 1);
    expect([found.status, found.plan]).toEqual([2, []]);
    expect(found.stderr).toContain('clean-arm preflight failed: gstack or a Capy drive is reachable');
    const broken = shard(['--clean-arm-preflight'], 2);
    expect([broken.status, broken.plan]).toEqual([2, []]);
    expect(broken.stderr).toContain('clean-arm preflight could not run (exit 2');
    expect(broken.stderr).not.toContain('is reachable');
  }, 30_000);
});
