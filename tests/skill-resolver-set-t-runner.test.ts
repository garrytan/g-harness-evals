// Set T trials through the runner (internal-task, task phase): the task directory run-trial.sh gets, grading the copied-out
// workspace, the skill-tasks cell rules, run-trial.sh's opt-in --env and --host-gateway (and its unchanged default), and one
// plan-and-run per attempt on the serve entry with a fixture adapter that writes the attempt's files into the seeded workspace.
// Keyless: dummy keys, no model call, no Docker daemon needed.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { buildManifest, cellModels, cellTasks, loadPrereg } from '../runner/run.ts';
import { executeRun } from '../runner/trial/run.ts';
import { loadTask } from '../runner/trial/task.ts';
import { SET_T_ACTOR, SET_T_SLICE, adapterWorkspaceEntries, gradeSetTWorkspace, qmSandboxImage, setTEnv, setTTaskDir, setTTaskIds, writeRunTrialTask, writeServeSetTTask } from '../runner/trial/set-t.ts';

const ROOT = join(import.meta.dir, '..');
const TASKS = join(ROOT, 'tasks');
const TASK = 't15-invoice-export-decision';
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir() };
const scratch = () => mkdtempSync(join(tmpdir(), 'sett-runner-'));

function workspaceWith(attempt: 'oracle' | 'obvious' | null, request?: string): string {
  const dir = scratch();
  const task = setTTaskDir(TASKS, TASK);
  writeRunTrialTask(task, join(dir, 'task'));
  const ws = join(dir, 'ws');
  cpSync(join(dir, 'task', 'workspace'), ws, { recursive: true });
  writeFileSync(join(ws, 'instruction.md'), request ?? readFileSync(join(dir, 'task', 'instruction.md')));
  if (attempt) cpSync(join(task, attempt), ws, { recursive: true });
  return ws;
}

describe('the run-trial.sh task directory', () => {
  test('instruction.md is the request byte for byte, workspace/ is start/, and the slice is skill-tasks', () => {
    const dir = scratch();
    const task = setTTaskDir(TASKS, TASK);
    writeRunTrialTask(task, dir);
    const t = JSON.parse(readFileSync(join(task, 'task.json'), 'utf8'));
    expect(readFileSync(join(dir, 'instruction.md'), 'utf8')).toBe(t.request);
    expect(readFileSync(join(dir, 'workspace', 'notes', 'incident.md'))).toEqual(readFileSync(join(task, 'start', 'notes', 'incident.md')));
    expect(readFileSync(join(dir, 'task.toml'), 'utf8')).toContain('slice = "skill-tasks"');
    expect(spawnSync('bash', [join(dir, 'grader', 'check.sh')]).status).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  test('the arm and the config reach the harness environment only when the cell sets them', () => {
    expect(setTEnv({})).toEqual({});
    expect(setTEnv({ skill_arm: 'resolver-on', config: 'route-hook' })).toEqual({ HE_SKILL_ARM: 'resolver-on', HE_HARNESS_CONFIG: 'route-hook' });
  });
});

describe('the QM sandbox image', () => {
  test('bakes start/ and instruction.md into a tag named by the base image and the files, and reuses an existing tag', () => {
    const dir = scratch();
    writeRunTrialTask(setTTaskDir(TASKS, TASK), join(dir, 'task'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const log = join(dir, 'docker.log');
    writeFileSync(join(bin, 'docker'), ['#!/usr/bin/env bash', 'echo "$*" >> "$STUB_DOCKER_LOG"',
      'if [ "$1 $2" = "image inspect" ]; then [ "$3" = -f ] && { echo sha256:base; exit 0; }; [ -e "$STUB_DOCKER_LOG.built" ] && exit 0; exit 1; fi',
      'if [ "$1" = build ]; then ctx=@@{!#}; ls -A "$ctx" > "$STUB_DOCKER_LOG.ctx"; touch "$STUB_DOCKER_LOG.built"; fi', 'exit 0', ''].join('\n').replaceAll('@@{', '${'));
    chmodSync(join(bin, 'docker'), 0o755);
    const saved = process.env.PATH;
    process.env.PATH = bin + ':' + saved;
    process.env.STUB_DOCKER_LOG = log;
    try {
      const tag = qmSandboxImage(join(dir, 'task'), ROOT);
      expect(tag).toMatch(/^harness-eval\/qm-sandbox:sett-[0-9a-f]{12}$/);
      expect(readFileSync(log + '.ctx', 'utf8').trim().split('\n').sort()).toEqual(['instruction.md', 'notes']);
      expect(readFileSync(log, 'utf8')).toContain('--build-arg BASE=harness-eval/qm-sandbox:dev -t ' + tag);
      expect(qmSandboxImage(join(dir, 'task'), ROOT)).toBe(tag);
      expect(readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('build ')).length).toBe(1);
    } finally { process.env.PATH = saved; delete process.env.STUB_DOCKER_LOG; }
  });
});

describe('grading the copied-out workspace', () => {
  test('the oracle passes, the obvious attempt fails used_it, doing nothing fails both; the seeded instruction.md is left out', () => {
    const task = setTTaskDir(TASKS, TASK);
    const oracle = gradeSetTWorkspace(task, workspaceWith('oracle'), 'native');
    expect({ success: oracle.success, used_it: oracle.used_it, instruction: oracle.instruction_md, arm: oracle.arm }).toEqual({ success: true, used_it: true, instruction: 'seeded', arm: 'native' });
    expect(oracle.checks.filter((c) => c.used_it).map((c) => c.id)).toEqual(['order', 'three-options']);
    const obvious = gradeSetTWorkspace(task, workspaceWith('obvious'), null);
    expect({ success: obvious.success, used_it: obvious.used_it }).toEqual({ success: false, used_it: false });
    expect(obvious.checks.filter((c) => !c.pass).every((c) => c.used_it)).toBe(true);
    const nothing = gradeSetTWorkspace(task, workspaceWith(null), null);
    expect({ success: nothing.success, used_it: nothing.used_it }).toEqual({ success: false, used_it: false });
  });

  test('an instruction.md the agent rewrote is graded as its output, and a missing one is recorded', () => {
    const task = setTTaskDir(TASKS, TASK);
    expect(gradeSetTWorkspace(task, workspaceWith('oracle', 'my own notes'), null).instruction_md).toBe('changed');
    const ws = workspaceWith('oracle');
    rmSync(join(ws, 'instruction.md'));
    expect(gradeSetTWorkspace(task, ws, null).instruction_md).toBe('absent');
  });
});

describe('skill-tasks cells', () => {
  const prereg = (cell: Record<string, unknown>) => {
    const dir = scratch();
    const file = join(dir, 'prereg.json');
    writeFileSync(file, JSON.stringify({ schema_version: 1, run_id: 'anatomy-capture-sett-cells', tasks: {}, spend_cap_usd: 1, cells: [{ id: 'c', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: SET_T_SLICE, split: 'dev', repetitions: 1, ceiling: { input_tokens: 1, output_tokens: 1 }, ...cell }] }));
    return file;
  };

  test('with no task list a cell runs all 48 tasks of set T; a listed task must exist', () => {
    const { prereg: p } = loadPrereg(prereg({}));
    expect(cellTasks(p, p.cells[0]!, TASKS)).toEqual(setTTaskIds(TASKS));
    expect(setTTaskIds(TASKS).length).toBe(48);
    const { prereg: q } = loadPrereg(prereg({ tasks: ['t99-nope'] }));
    expect(() => cellTasks(q, q.cells[0]!, TASKS)).toThrow(/no such task/);
  });

  test('a QM skill-tasks cell admits its housekeeping model through utility_models, as earlier QM cells do', () => {
    const { prereg: p } = loadPrereg(prereg({ harness: 'qm', utility_models: ['anthropic:claude-haiku-5-5'] }));
    expect(cellModels(p.cells[0]!)).toEqual(['anthropic:claude-opus-5-5', 'anthropic:claude-haiku-5-5']);
  });

  test('skill_arm is a lowercase name on a skill-tasks cell only', () => {
    expect(loadPrereg(prereg({ skill_arm: 'no-catalog' })).prereg.cells[0]!.skill_arm).toBe('no-catalog');
    expect(() => loadPrereg(prereg({ skill_arm: 'Native Arm' }))).toThrow(/skill_arm/);
    expect(() => loadPrereg(prereg({ slice: 'hello', skill_arm: 'native' }))).toThrow(/skill_arm/);
  });
});

/** A docker stand-in: logs its arguments, and for run copies $STUB_ATTEMPT_DIR into the directory mounted at /workspace. */
function stubDocker(dir: string): { bin: string; log: string } {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(dir, 'docker.log');
  writeFileSync(join(bin, 'docker'), [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$@" >> "$STUB_DOCKER_LOG"; echo --- >> "$STUB_DOCKER_LOG"',
    '[ "$1" = run ] || exit 0',
    'ws="" prev=""',
    'for a in "$@"; do if [ "$prev" = -v ] && [[ $a == *:/workspace ]]; then ws=${a%:/workspace}; fi; prev=$a; done',
    'if [ -n "${STUB_ATTEMPT_DIR:-}" ]; then cp -r "$STUB_ATTEMPT_DIR/." "$ws/"; fi',
    'exit 0', ''].join('\n'));
  chmodSync(join(bin, 'docker'), 0o755);
  return { bin, log };
}

describe('harnesses/run-trial.sh opt-in flags', () => {
  const runTrial = (extra: string[]) => {
    const dir = scratch();
    const { bin, log } = stubDocker(dir);
    writeRunTrialTask(setTTaskDir(TASKS, TASK), join(dir, 'task'));
    const r = spawnSync('bash', ['harnesses/run-trial.sh', '--harness', '_fake', '--task', join(dir, 'task'), '--trial-id', 'sett-flags', '--base-url', 'http://127.0.0.1:1/none', '--api-key', 'trial-token:x', '--out', join(dir, 'out'), ...extra],
      { cwd: ROOT, env: { ...ENV, PATH: bin + ':' + ENV.PATH, STUB_DOCKER_LOG: log }, encoding: 'utf8' });
    return { status: r.status, args: existsSync(log) ? readFileSync(log, 'utf8').split('---\n')[0]!.trim().split('\n') : [] };
  };

  test('without them, docker run gets the same arguments as before: host-gateway and no extra environment', () => {
    const { status, args } = runTrial([]);
    expect(status).toBe(0);
    expect(args).toContain('host.docker.internal:host-gateway');
    expect(args.filter((a, i) => args[i - 1] === '-e').map((a) => a.split('=')[0])).toEqual(['HE_MODEL_BASE_URL', 'HE_MODEL_API_KEY', 'HE_MODEL_NAME', 'HE_TIME_BUDGET_S', 'HE_LOG_DIR', 'HE_SESSION_STATE_DIR', 'HE_TASK_SLICE', 'HE_TRIAL_ID']);
    expect(args.at(-2)).toBe('harness-eval/fake:dev');
    expect(args.at(-1)).toBe('run');
  });

  test('--env adds -e NAME=VALUE before the image, and --host-gateway maps host.docker.internal to the given address', () => {
    const { status, args } = runTrial(['--env', 'HE_SKILL_ARM=native', '--env', 'HE_HARNESS_CONFIG=route-hook', '--network', 'he-net-x', '--host-gateway', '172.30.0.1']);
    expect(status).toBe(0);
    expect(args).toContain('host.docker.internal:172.30.0.1');
    expect(args[args.indexOf('--network') + 1]).toBe('he-net-x');
    expect(args[args.indexOf('HE_SKILL_ARM=native') - 1]).toBe('-e');
    expect(args[args.indexOf('HE_HARNESS_CONFIG=route-hook') - 1]).toBe('-e');
    expect(args.indexOf('HE_SKILL_ARM=native')).toBeLessThan(args.indexOf('harness-eval/fake:dev'));
    expect(runTrial(['--env', 'lower=x']).status).toBe(64);
  });
});

// OpenClaw, Claude Code, Codex and Hermes run set T on the serve entry (their skill arms are wired there only). A fixture adapter
// plays the harness in process mode: it records what the workspace held when it started, and on the member turn copies the
// attempt's files into its working directory, the trial's workspace.
const SERVE_FIXTURE = `#!/usr/bin/env bun
const fs = require('fs'), path = require('path');
const E = process.env, logs = E.HE_LOG_DIR, turns = E.HE_TURNS_DIR, ws = E.HE_WORKSPACE_DIR;
fs.mkdirSync(logs, { recursive: true }); fs.mkdirSync(turns, { recursive: true });
process.on('SIGTERM', () => process.exit(0));
fs.writeFileSync(logs + '/ready', JSON.stringify({ seeded: fs.readdirSync(ws).sort(), skill_arm: E.HE_SKILL_ARM ?? null, config: E.HE_HARNESS_CONFIG ?? null }));
const seen = new Set();
while (true) {
  for (const f of fs.readdirSync(turns).filter((f) => f.endsWith('.request.json')).sort()) {
    if (seen.has(f)) continue;
    seen.add(f);
    const req = JSON.parse(fs.readFileSync(path.join(turns, f), 'utf8'));
    fs.writeFileSync(logs + '/turn.json', JSON.stringify({ text: req.text, channel: req.channel }));
    if (E.STUB_ATTEMPT_DIR) fs.cpSync(E.STUB_ATTEMPT_DIR, ws, { recursive: true });
    if (E.STUB_ADAPTER_SKILLS) { fs.mkdirSync(ws + '/skills/accelerate', { recursive: true }); fs.writeFileSync(ws + '/skills/accelerate/SKILL.md', '# decision.md ordered three options'); }
    const out = path.join(turns, f.replace('.request.json', '.response.json'));
    fs.writeFileSync(out + '.tmp', JSON.stringify({ turn: req.turn, exit: 0, reply_text: 'done', started_at: new Date().toISOString(), ended_at: new Date().toISOString() }));
    fs.renameSync(out + '.tmp', out);
  }
  await Bun.sleep(50);
}
`;

describe('the runner on a skill-tasks cell, serve entry (fixture adapter, process mode)', () => {
  const runCell = async (attempt: 'oracle' | 'obvious', harness = 'claude-code', extraEnv: Record<string, string> = {}) => {
    const dir = scratch();
    const adapter = join(dir, 'adapter.ts');
    writeFileSync(adapter, SERVE_FIXTURE, { mode: 0o755 });
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ schema_version: 1, run_id: 'sett-serve-' + attempt, question: 'keyless test', tasks: {}, spend_cap_usd: 1, wall_clock_s: { [SET_T_SLICE]: 3600 }, drop_order: [], minimum_v01: [],
      cells: [{ id: 'cc-native', harness, model: 'anthropic:claude-opus-5-5', slice: SET_T_SLICE, split: 'dev', tasks: [TASK], repetitions: 1, skill_arm: 'native', config: 'skills-native', harness_mode: 'process', adapter, ceiling: { input_tokens: 1000, output_tokens: 100 } }] }));
    const { prereg: p, sha256 } = loadPrereg(join(dir, 'prereg.json'));
    mkdirSync(join(dir, 'run'));
    const manifestPath = join(dir, 'run', 'manifest.json');
    const manifest = buildManifest(p, sha256, '2026-11-08T00:00:00Z');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = await executeRun(manifest, manifestPath, { harnessMode: 'process', preamblePath: join(ROOT, 'tests', 'fixtures', 'preamble.md'), grade: (() => { throw new Error('the set T path grades with its checker'); }) as never,
      proxyEnv: { ...ENV, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' }, turnGraceS: 1, stopGraceS: 2, readyTimeoutS: 20, repoRoot: ROOT,
      harnessEnv: { STUB_ATTEMPT_DIR: join(setTTaskDir(TASKS, TASK), attempt), ...extraEnv } });
    const record = result.records[0]!;
    return { record, ready: JSON.parse(readFileSync(join(record.paths.dir, 'logs', 'ready'), 'utf8')), turn: JSON.parse(readFileSync(join(record.paths.dir, 'logs', 'turn.json'), 'utf8')) };
  };

  test('start/ and instruction.md are in the workspace before the harness starts; the oracle grades success and used_it there', async () => {
    const { record, ready, turn } = await runCell('oracle');
    const t = JSON.parse(readFileSync(join(setTTaskDir(TASKS, TASK), 'task.json'), 'utf8'));
    expect(ready).toEqual({ seeded: ['instruction.md', 'notes'], skill_arm: 'native', config: 'skills-native' });
    expect({ text: turn.text === t.request, channel: turn.channel.type ?? turn.channel.name }).toEqual({ text: true, channel: expect.any(String) });
    expect({ grade: record.grade, termination: record.termination, success: record.set_t?.success, used_it: record.set_t?.used_it, arm: record.set_t?.arm, instruction: record.set_t?.instruction_md, mode: record.harness_mode })
      .toEqual({ grade: 'pass', termination: 'completed', success: true, used_it: true, arm: 'native', instruction: 'seeded', mode: 'process' });
    expect(record.set_t!.checks.map((c) => c.id)).toEqual(['doc', 'topic', 'order', 'three-options']);
    expect(record.paths.workspace).toBe(join(record.paths.dir, 'workspace'));
    expect(existsSync(join(record.paths.workspace!, 'decision.md'))).toBe(true);
  }, 120_000);

  test('the obvious attempt grades used_it false and success false', async () => {
    const { record } = await runCell('obvious');
    expect({ grade: record.grade, success: record.set_t?.success, used_it: record.set_t?.used_it }).toEqual({ grade: 'fail', success: false, used_it: false });
    expect(record.set_t!.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual(['order', 'three-options']);
  }, 120_000);

  test("OpenClaw's catalog at /workspace/skills is left out of grading; other harnesses keep every file", () => {
    const task = setTTaskDir(TASKS, TASK);
    expect(adapterWorkspaceEntries('openclaw', task)).toEqual(['skills']);
    expect(adapterWorkspaceEntries('claude-code', task)).toEqual([]);
    const ws = workspaceWith('obvious');
    mkdirSync(join(ws, 'skills', 'x'), { recursive: true });
    writeFileSync(join(ws, 'skills', 'x', 'SKILL.md'), 'stray');
    const kept = gradeSetTWorkspace(task, ws, null, []);
    const dropped = gradeSetTWorkspace(task, ws, null, ['skills']);
    expect(existsSync(join(ws, 'skills'))).toBe(true);
    expect({ kept: kept.instruction_md, dropped: dropped.instruction_md }).toEqual({ kept: 'seeded', dropped: 'seeded' });
  });

  test('the serve task is one DM with the request verbatim, and its workspace seed is start/ plus instruction.md', () => {
    const dir = scratch();
    const task = setTTaskDir(TASKS, TASK);
    writeServeSetTTask(task, dir);
    const t = JSON.parse(readFileSync(join(task, 'task.json'), 'utf8'));
    const spec = loadTask(dir);
    expect({ slice: spec.slice, turns: spec.turns, actors: spec.actors, required: spec.predicates.required }).toEqual({ slice: SET_T_SLICE, turns: [{ actor: SET_T_ACTOR, channel: 'dm', text: t.request }], actors: [SET_T_ACTOR], required: [] });
    expect(readFileSync(join(dir, 'workspace', 'instruction.md'), 'utf8')).toBe(t.request);
    expect(readFileSync(join(dir, 'workspace', 'notes', 'incident.md'))).toEqual(readFileSync(join(task, 'start', 'notes', 'incident.md')));
  });
});
