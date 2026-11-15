// The gbrain canary's stop path (scripts/canary/gbrain/run-tier.sh): a TERM or INT while the arms run at once, keyless,
// with --fake and a stub bun whose fake-shard step stands in for scripts/run-shard.sh: a shell with run-shard.sh's TERM
// trap that runs a sleeping child in the foreground, as run-shard.sh runs bun runner/run.ts, so the arm shards and their
// runners are still running when the signal lands. The scripts run under env -i with PATH, HOME and the stub's two variables.
//
// Value: protects=a stopped gbrain tier taking its concurrent arm shards (scripts/run-shard.sh in a real run) and the
// runners under them down with it and exiting non-zero; fails_when=run-tier.sh dies on TERM or INT and leaves an arm's
// shard or its runner running, signals only the shard (whose trap waits for its foreground runner), exits 0, or returns
// before they are gone; seam=a stub bun on HOME/.bun/bin in place of the fake shard; no_claim=that runner/run.ts or
// docker remove the trial containers once the runner is signalled.
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'he-canary-gbrain-stop-')));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const P593 = '27f8b9d6287c2ba635532c7d3bc015c50e1d769b';
const P613 = '98dda48fb9fd339609d6d4eef009811280ff648d';
const TASKS = {
  suite: 'gbrain',
  models: {
    opus: { tasks: ['cn-01-marrow-fieldworks-site'], t1: ['cn-01-marrow-fieldworks-site', 'si-01-tansley-parcel-site'], digest: [] },
    sol: { tasks: ['cn-01-marrow-fieldworks-site'], t1: ['si-01-tansley-parcel-site'], digest: [] },
  },
};

/** Whether a pid is a live process (gone or a zombie both count as stopped). */
const running = (pid: number) => {
  try { return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; }
};

async function stopWhileArmsRun(signal: 'SIGTERM' | 'SIGINT') {
  const base = mkdtempSync(join(tmp, 'case-'));
  const home = join(base, 'home'), stub = join(base, 'stub'), out = join(base, 'out');
  mkdirSync(join(home, '.bun/bin'), { recursive: true });
  mkdirSync(stub);
  writeFileSync(join(home, '.bun/bin/bun'), '#!/usr/bin/env bash\nif [ "${2:-}" = fake-shard ]; then echo "$$" >> "$STUB_BUN_DIR/shards"; trap "exit 143" TERM; bash -c \'echo $$ >> "$STUB_BUN_DIR/runners"; exec sleep 300\'; exit $?; fi\nexec "$STUB_REAL_BUN" "$@"\n');
  chmodSync(join(home, '.bun/bin/bun'), 0o755);
  const tasks = join(base, 'tasks.json');
  writeFileSync(tasks, JSON.stringify(TASKS));
  const proc = Bun.spawn(['bash', join(ROOT, 'scripts/canary/gbrain/run-tier.sh'), '--tier', 'T1', '--prev', P593, '--new', P613, '--tasks', tasks, '--attempts', '1',
    '--arms', 'plain,prev,new', '--models', 'opus,sol', '--lease-usd', '42', '--run-id', 'canary-stop', '--out', out, '--fake'],
  { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, STUB_BUN_DIR: stub, STUB_REAL_BUN: process.execPath }, stdout: 'ignore', stderr: 'pipe' });
  const listed = (f: string) => (existsSync(join(stub, f)) ? readFileSync(join(stub, f), 'utf8').split('\n').filter(Boolean).map(Number) : []);
  for (let i = 0; i < 600 && listed('runners').length < 3 && proc.exitCode === null; i++) await Bun.sleep(100);
  expect(listed('shards')).toHaveLength(3);
  expect(listed('runners')).toHaveLength(3);
  const pids = [...listed('shards'), ...listed('runners')];
  expect(pids.every(running)).toBe(true);
  proc.kill(signal);
  const code = await proc.exited;
  const stillRunning = pids.filter(running);
  for (const pid of stillRunning) process.kill(pid, 'SIGKILL');
  return { code, signalCode: proc.signalCode, stillRunning, log: readFileSync(join(out, 'run-tier.log'), 'utf8'), trials: existsSync(join(out, 'trials.jsonl')) };
}

async function stopWhileAggregating() {
  const base = mkdtempSync(join(tmp, 'agg-'));
  const home = join(base, 'home'), stub = join(base, 'stub'), out = join(base, 'out');
  mkdirSync(join(home, '.bun/bin'), { recursive: true });
  mkdirSync(stub);
  writeFileSync(join(home, '.bun/bin/bun'), '#!/usr/bin/env bash\nout_of() { local o=""; while [ $# -gt 0 ]; do [ "$1" != --out ] || o=$2; shift; done; echo "$o"; }\nif [ "${2:-}" = fake-shard ]; then o=$(out_of "$@"); mkdir -p "$o"; echo "{}" > "$o/trials.jsonl"; exit 0; fi\nif [ "${2:-}" = annotate ]; then echo "{\\"usage\\":{\\"usd\\":1}}" >> "$(out_of "$@")"; echo "$$" >> "$STUB_BUN_DIR/annotating"; sleep 2; exit 0; fi\nexec "$STUB_REAL_BUN" "$@"\n');
  chmodSync(join(home, '.bun/bin/bun'), 0o755);
  const tasks = join(base, 'tasks.json');
  writeFileSync(tasks, JSON.stringify(TASKS));
  const proc = Bun.spawn(['bash', join(ROOT, 'scripts/canary/gbrain/run-tier.sh'), '--tier', 'T1', '--prev', P593, '--new', P613, '--tasks', tasks, '--attempts', '1',
    '--arms', 'plain,prev,new', '--models', 'opus,sol', '--lease-usd', '42', '--run-id', 'canary-stop-agg', '--out', out, '--fake'],
  { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, STUB_BUN_DIR: stub, STUB_REAL_BUN: process.execPath }, stdout: 'ignore', stderr: 'pipe' });
  for (let i = 0; i < 600 && !existsSync(join(stub, 'annotating')) && proc.exitCode === null; i++) await Bun.sleep(100);
  expect(existsSync(join(stub, 'annotating'))).toBe(true);
  proc.kill('SIGTERM');
  const code = await proc.exited;
  return { code, signalCode: proc.signalCode, log: readFileSync(join(out, 'run-tier.log'), 'utf8'), trials: existsSync(join(out, 'trials.jsonl')) };
}

describe('run-tier.sh stopped while its arms run at once', () => {
  test('TERM while the shards\' rows are being added removes the partial trials.jsonl and exits 143', async () => {
    const r = await stopWhileAggregating();
    expect(r.signalCode).toBeNull();
    expect(r.code).toBe(143);
    expect(r.log).toContain('stopped by SIGTERM');
    expect(r.trials).toBe(false);
  }, 120_000);
  test('TERM stops every arm shard, waits for them and exits 143', async () => {
    const r = await stopWhileArmsRun('SIGTERM');
    expect(r.signalCode).toBeNull();
    expect(r.code).toBe(143);
    expect(r.stillRunning).toEqual([]);
    expect(r.log).toContain('stopped by SIGTERM: stopping the arm shards');
    expect(r.log).toContain('the arm shards stopped');
    expect(r.trials).toBe(false);
  }, 120_000);
  test('INT does the same and exits 130', async () => {
    const r = await stopWhileArmsRun('SIGINT');
    expect(r.code).toBe(130);
    expect(r.stillRunning).toEqual([]);
    expect(r.log).toContain('stopped by SIGINT: stopping the arm shards');
  }, 120_000);
});
