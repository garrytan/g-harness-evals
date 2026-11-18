// ubi-runner.sh run --pull: a failed results pull is tried again, and a pull that never succeeds keeps the VM instead of
// destroying the only copy of its results. Before this, cmd_run logged the failed pull and destroyed the VM, so a dropped
// connection lost the results; the regression canary then charged its lease from whatever rows had arrived.
//
// Value: protects=a pull cut by a dropped connection is retried and the results arrive whole before the VM goes; a pull
// that fails every try exits non-zero, never sends a destroy, reports the VM as left=1 kept=1 and prints the pull and down
// commands, which then recover the results and take the VM down; fails_when=a failed pull is followed by a destroy, or one
// failed try fails the run; why_new=no test ran cmd_run's pulls; seam=the fake Ubicloud API and fake ssh in
// tests/helpers/ubi-runner-fake-vm.ts (its pull-fails count); no_claim=a real VM, ssh or tar over a network.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeVm } from './helpers/ubi-runner-fake-vm';

const ROWS = '{"trial":1,"usage":{"usd":0.5}}\n'.repeat(400);

function setup(fails: number) {
  const f = fakeVm();
  mkdirSync(join(f.root, 'remote-fs/out'), { recursive: true });
  writeFileSync(join(f.root, 'remote-fs/out/trials.jsonl'), ROWS);
  writeFileSync(join(f.root, 'pull-fails'), String(fails));
  const dest = join(f.root, 'local');
  const r = f.run(['run', '--src', f.src, '--pull', 'out:' + dest, '--', 'true'], { UBI_REAP: '0', UBI_PULL_PAUSE: '0' });
  return { f, dest, r, err: r.stderr.toString() };
}

describe('ubi-runner run --pull', () => {
  test('a pull cut once is tried again; the results arrive whole and the VM is destroyed', () => {
    const { f, dest, r, err } = setup(1);
    expect(r.exitCode, err).toBe(0);
    expect(err).toContain('pull of out:' + dest + ' failed (try 1 of 3)');
    expect(err).not.toContain('pull failed:');
    expect(readFileSync(join(dest, 'out/trials.jsonl'), 'utf8')).toBe(ROWS);
    expect(f.calls()).toContain('destroy');
    expect(f.listed()).toBe('');
    expect(err).toMatch(/UBICLOUD: left=0 owner=thrd1 /);
  });

  test('a pull that fails every try exits non-zero and keeps the VM, and the printed commands recover the results', () => {
    const { f, dest, r, err } = setup(99);
    expect(r.exitCode, err).toBe(1);
    expect(err).toContain('failed (try 2 of 3)');
    expect(err).toContain('pull failed: out:' + dest);
    expect(f.calls()).not.toContain('destroy');
    const vm = /UBICLOUD: left=1 owner=thrd1 vm=(\S+) kept=1/.exec(err)?.[1];
    expect(vm, err).toBeTruthy();
    expect(f.listed()).toContain(vm!);
    expect(err).toContain('UBI_PULL_FAILED: kept ' + vm + ' (it carries its TTL)');
    expect(err).toContain('pull ' + vm + ' out ' + dest + ', then destroy it with: ');
    writeFileSync(join(f.root, 'pull-fails'), '0');
    const pull = f.run(['pull', vm!, 'out', dest]);
    expect(pull.exitCode, pull.stderr.toString()).toBe(0);
    expect(readFileSync(join(dest, 'out/trials.jsonl'), 'utf8')).toBe(ROWS);
    const down = f.run(['down', vm!]);
    expect(down.exitCode, down.stderr.toString()).toBe(0);
    expect(f.listed()).toBe('');
  });

  test('a bad UBI_PULL_TRIES or UBI_PULL_PAUSE is refused before any VM is made', () => {
    const f = fakeVm();
    for (const [k, v] of [['UBI_PULL_TRIES', '0'], ['UBI_PULL_TRIES', 'x'], ['UBI_PULL_PAUSE', '-1'], ['UBI_PULL_PAUSE', '08']]) {
      const r = f.run(['run', '--src', f.src, '--', 'true'], { [k!]: v! });
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toContain(k + ' must be a whole number');
    }
    expect(f.calls()).not.toContain('"create"');
  });
});
