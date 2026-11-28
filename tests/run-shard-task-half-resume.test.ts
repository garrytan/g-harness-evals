// scripts/run-shard.sh --resume and a run planned in two (R113): a resume repeats the half its shard started with. Before the
// check, a resume that left out --task-half ran the runner with no task filter, so a half 1 shard also ran half 2's tasks and
// the stage-1 look read more than half of each family (the /ship review of the owner-identity preregistration found it).
// The runner also runs with --stop-on-cap, so a spent lease ends the shard on one recorded cap stop that merge-shards.ts
// --partial accepts; before, the runner went on to the next trial and every later one was refused too.
//
// Value: protects=a resume whose --task-half differs from shard.json's task_half, or is missing, or is added to a shard that
// had none, exits 2 before any build or trial, and the matching resume passes the check; fails_when=the check is dropped or
// compares the wrong field; seam=fake docker and bun on PATH in a throwaway clean checkout holding a copy of the script (as
// tests/run-shard-set-world.test.ts); no_claim=what runner/run.ts --task-half runs (tests/merge-shards-task-half.test.ts and
// the runner's own tests).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'run-shard-half-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function resume(recorded: number | null, args: string[], fresh = false) {
  const dir = mkdtempSync(join(tmp, 'repo-'));
  const bin = join(dir, '.fake-bin');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(bin);
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(dir, 'scripts', 'run-shard.sh'));
  const script = (path: string, body: string) => { writeFileSync(path, '#!/usr/bin/env bash\n' + body + '\n'); chmodSync(path, 0o755); };
  const logs = mkdtempSync(join(tmp, 'logs-'));
  script(join(bin, 'docker'), 'if [ "$1 $2" = "image inspect" ]; then echo sha256:fake; fi\nexit 0');
  if (fresh) script(join(bin, 'sleep'), 'exit 1');
  script(join(bin, 'bun'), fresh ? 'echo "$*" >> ' + join(logs, 'bun') + '\ncase " $* " in *" preflight "*) echo "PREFLIGHT: ok" ;; esac\nexit 0' : 'exit 1');
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'half-resume-test', cells: [{ id: 'c', harness: 'openclaw', split: 'dev' }] }));
  writeFileSync(join(dir, '.gitignore'), '.fake-bin/\nresults/\n');
  const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
  const out = join(dir, 'results', 'half-resume-test');
  mkdirSync(out, { recursive: true });
  if (fresh) return { ...run(dir, args, bin), bun: () => readFileSync(join(logs, 'bun'), 'utf8') };
  writeFileSync(join(out, 'shard.json'), JSON.stringify({ name: 's', commit: 'c'.repeat(40), cells: 'c', ...(recorded ? { task_half: recorded } : {}) }));
  writeFileSync(join(out, 'trials.jsonl'), JSON.stringify({ trial_id: 'half-resume-test/c/t1/r1' }) + '\n');
  return { ...run(dir, args, bin), bun: () => '' };
}

function run(dir: string, args: string[], bin: string) {
  const p = spawnSync('bash', ['--noprofile', '--norc', join(dir, 'scripts', 'run-shard.sh'), '--prereg', 'prereg.json', '--name', 's', '--cells', 'c', '--lease-usd', '1', '--skip-build', ...args],
    { cwd: dir, encoding: 'utf8', env: { PATH: bin + ':' + (process.env.PATH ?? '/usr/bin:/bin'), HOME: mkdtempSync(join(tmp, 'home-')) } });
  return { status: p.status, stderr: p.stderr };
}

describe('run-shard.sh: a resume repeats the half its shard started with', () => {
  test('a half 1 shard resumed with no --task-half, or with --task-half 2, is refused before anything runs', () => {
    for (const args of [['--resume'], ['--resume', '--task-half', '2'], []]) {
      const r = resume(1, args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('shard.json records task_half 1 and this launch passes --task-half ' + (args.includes('2') ? '2' : 'none'));
    }
  });

  test('a shard with no half resumed with --task-half 1 is refused, and the matching resumes pass the check', () => {
    const added = resume(null, ['--resume', '--task-half', '1']);
    expect(added.status).toBe(2);
    expect(added.stderr).toContain('records task_half none and this launch passes --task-half 1');
    expect(resume(1, ['--resume', '--task-half', '1']).stderr).not.toContain('records task_half');
    expect(resume(null, ['--resume']).stderr).not.toContain('records task_half');
  });

  test('a launch runs the runner with --stop-on-cap, so a spent lease ends the shard on one recorded cap stop', () => {
    const r = resume(null, ['--task-half', '1'], true);
    const runLine = r.bun().split('\n').find((l) => l.startsWith('runner/run.ts run '));
    expect(runLine).toContain('--stop-on-cap');
    expect(runLine).toContain('--task-half 1');
  });
});
