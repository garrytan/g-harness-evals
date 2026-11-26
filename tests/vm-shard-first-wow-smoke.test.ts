// scripts/ubicloud/vm-shard.sh's one-trial smoke for gbrain first-wow shards: the smoke preregistration takes each cell's first
// listed seed (a coding cell's first coding seed, --smoke-task when the cell lists it) instead of a multi-user task directory, and
// the smoke's pass check needs a first-wow score on every first-wow trial, plain arm included, not only termination completed.
//
// Value: protects=the four frozen shards of gbrain-first-wow-2026-12 each get a one-trial preregistration that plan accepts, and a
// completed first-wow trial with no score fails the smoke; fails_when=the first-wow branch is dropped (the smoke looks for
// tasks/multiuser/dev seeds and exits), --smoke-task is ignored or forced onto a cell that does not list it, or the pass check
// reads termination alone; why_new=a second-model read found the standard shard path could not launch these cells; seam=the
// two heredocs vm-shard.sh runs, read from the script itself, and runner/run.ts plan; no_claim=the VM side (images, proxy, trial).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PREREG = join(ROOT, 'docs', 'benchmarks', '2026-11-24-gbrain-first-wow', 'prereg.json');
const SCRIPT = readFileSync(join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh'), 'utf8');
const heredoc = (marker: string) => SCRIPT.slice(SCRIPT.indexOf(marker) + marker.length).split('\nPY\n')[0]!;
const SMOKE_PY = heredoc("<<'PY' || finish 2\n");
const CHECK_PY = heredoc('"$smoke_prereg" <<\'PY\'\n');
const tmp = mkdtempSync(join(tmpdir(), 'he-fw-smoke-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

const SHARDS: Array<[string, string[]]> = [
  ['1', ['qm-opus-native', 'qm-sol-native', 'qm-opus-plain']],
  ['2', ['qm-particle-native', 'qm-sol-plain', 'qm-particle-plain']],
  ['3', ['cc-opus-defaults', 'cc-opus-pr1', 'cc-opus-full', 'cc-opus-defaults-coding', 'cc-opus-full-coding']],
  ['4', ['cc-opus-plain', 'codex-sol-defaults', 'codex-sol-pr1', 'codex-sol-plain']],
];

function smoke(cells: string[], task = '') {
  const dir = join(tmp, String(++n));
  spawnSync('mkdir', ['-p', dir]);
  writeFileSync(join(dir, 'smoke.py'), SMOKE_PY);
  const out = join(dir, 'prereg.json');
  const r = spawnSync('python3', [join(dir, 'smoke.py'), PREREG, cells.join(','), 'shard', task, '6', out, '0'], { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, encoding: 'utf8' });
  return { code: r.status, err: r.stderr, out, dir, prereg: r.status === 0 ? JSON.parse(readFileSync(out, 'utf8')) as { run_id: string; cells: Array<{ id: string; tasks: string[]; repetitions: number }> } : undefined };
}

describe('vm-shard.sh smoke preregistration for gbrain first-wow shards', () => {
  for (const [name, cells] of SHARDS) {
    test(`shard ${name}: one listed seed per cell, and plan accepts it`, () => {
      const r = smoke(cells);
      expect([r.code, r.err]).toEqual([0, '']);
      expect(r.prereg!.cells.map((c) => c.id).sort()).toEqual([...cells].sort());
      for (const c of r.prereg!.cells) expect([c.tasks, c.repetitions]).toEqual([[c.id.endsWith('-coding') ? 'seed-0200' : 'seed-0000'], 1]);
      const plan = spawnSync('bun', ['runner/run.ts', 'plan', '--prereg', r.out, '--out', join(r.dir, 'plan')], { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: r.dir }, encoding: 'utf8' });
      expect(plan.stderr).not.toContain('HE-');
      expect(plan.status).toBe(0);
    }, 60_000);
  }

  test('--smoke-task applies to the cells that list it, and the others keep their first seed', () => {
    const coding = smoke(SHARDS[2]![1], 'seed-0203');
    expect(coding.code).toBe(0);
    expect(Object.fromEntries(coding.prereg!.cells.map((c) => [c.id, c.tasks[0]]))).toEqual({ 'cc-opus-defaults': 'seed-0000', 'cc-opus-pr1': 'seed-0000', 'cc-opus-full': 'seed-0000', 'cc-opus-defaults-coding': 'seed-0203', 'cc-opus-full-coding': 'seed-0203' });
    const questions = smoke(['cc-opus-defaults', 'cc-opus-full-coding'], 'seed-9003');
    expect(Object.fromEntries(questions.prereg!.cells.map((c) => [c.id, c.tasks[0]]))).toEqual({ 'cc-opus-defaults': 'seed-9003', 'cc-opus-full-coding': 'seed-0200' });
  });
});

describe("vm-shard.sh smoke pass check", () => {
  const check = (rows: object[]) => {
    const dir = join(tmp, String(++n));
    spawnSync('mkdir', ['-p', dir]);
    writeFileSync(join(dir, 'check.py'), CHECK_PY);
    writeFileSync(join(dir, 'trials.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ cells: [{ id: 'fw', slice: 'gbrain-first-wow' }, { id: 'fw-plain', slice: 'gbrain-first-wow' }, { id: 'mu', slice: 'multiuser' }] }));
    return spawnSync('python3', [join(dir, 'check.py'), join(dir, 'trials.jsonl'), join(dir, 'prereg.json')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  };
  const row = (cell: string, over: object = {}) => ({ trial_id: `run/${cell}/seed-0000/r1`, cell, termination: 'completed', grade: 'n/a', ...over });
  const score = { questions: [], finish_any: false };

  test('the heredoc is found', () => expect(CHECK_PY).toContain('first_wow'));
  test('a first-wow trial passes with questions scored or a coding grade, plain arm included', () => {
    expect(check([row('fw', { first_wow: { arm: 'pr1', score } }), row('fw-plain', { first_wow: { arm: 'plain', score } }), row('fw', { first_wow: { arm: 'full', score: null, coding: { task: 'c', grade: { passed: false } } } })]).status).toBe(0);
    expect(check([row('mu')]).status).toBe(0);
  });
  test('a completed first-wow trial with no score, or no first_wow record, fails the smoke', () => {
    for (const r of [row('fw', { first_wow: { arm: 'pr1', score: null } }), row('fw-plain', { first_wow: { arm: 'plain', score: null } }), row('fw'), row('fw', { first_wow: { arm: 'full', score: null, coding: { task: 'c', grade: null } } })]) {
      const p = check([r]);
      expect(p.status).toBe(1);
      expect(p.stdout).toContain('1 not completed or unscored');
    }
  });
});
