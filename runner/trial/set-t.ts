// Set T trials (internal-task task phase): one graded skill task through one harness, as one member turn.
//
// A set T task (tasks/skill-resolver/T/tasks/<id>/, format in that set's README) has start/ files, a request and a
// deterministic checker. Each harness runs it on the entry its skill arms are wired on:
//   OpenClaw, Claude Code, Codex, Hermes  the serve entry (scripts/skill-resolver/ARMS.md). writeServeSetTTask writes a one-turn
//       task (the request as a DM from SET_T_ACTOR) and a workspace seed (start/ plus instruction.md); the runner copies the seed
//       into the trial's workspace, mounted at /workspace (the adapter's working directory), before the harness starts.
//   QM  the run entry (harnesses/run-trial.sh). writeRunTrialTask writes a task directory run-trial.sh understands, with
//       instruction.md holding the request verbatim, workspace/ holding start/ and a grader that defers to this module;
//       run-trial.sh copies both in and capture.sh copies the sandbox workspace back over <trial dir>/workspace.
// Either way the workspace ends in <trial dir>/workspace. This module then grades a copy of that workspace with
// scripts/skill-resolver/check-set-t.ts, leaving out instruction.md when it still holds the request byte for byte, and
// returns the checker's verdict for the trial record: success (every check), used_it (the used_it checks) and each check.
//
// The arm (native, resolver-on, no-catalog, defined by the arm configs) is opaque here: the cell's skill_arm reaches the
// adapter as HE_SKILL_ARM and the record, and the cell's config as HE_HARNESS_CONFIG, so this path is the same for every arm.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TrialSetT } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { grade, type Task } from '../../scripts/skill-resolver/check-set-t.ts';

/** Where set T lives under tasks/, and the slice name cells use for it. */
export const SET_T_SLICE = 'skill-tasks';
export const SET_T_DIR = join('skill-resolver', 'T', 'tasks');
/** Wall clock per set T trial (HE_TIME_BUDGET_S); run-trial.sh adds its own kill grace. */
export const SET_T_TIME_BUDGET_S = 1200;
/** The member who sends a set T request on the serve entry: a member of the v0.1 seed world. */
export const SET_T_ACTOR = 'dana-okafor';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export function setTTaskDir(tasksRoot: string, id: string): string {
  return join(tasksRoot, SET_T_DIR, id);
}

export function setTTaskIds(tasksRoot: string): string[] {
  const root = join(tasksRoot, SET_T_DIR);
  return existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'task.json'))).map((d) => d.name).sort() : [];
}

export function loadSetTTask(taskDir: string): Task {
  const file = join(taskDir, 'task.json');
  if (!existsSync(file)) throw new RunnerError('HE-TASK-001', `${taskDir}/task.json is missing; fix: name a task of set T (tasks/skill-resolver/T/README.md)`);
  return JSON.parse(readFileSync(file, 'utf8')) as Task;
}

/** The task directory harnesses/run-trial.sh runs: instruction.md (the request, verbatim, no added newline), workspace/
 *  (start/), task.toml (slice and time budget) and grader/check.sh, which only says the runner grades. Returns its path. */
export function writeRunTrialTask(taskDir: string, outDir: string, timeBudgetS = SET_T_TIME_BUDGET_S): string {
  const t = loadSetTTask(taskDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'grader'), { recursive: true });
  writeFileSync(join(outDir, 'instruction.md'), t.request);
  cpSync(join(taskDir, 'start'), join(outDir, 'workspace'), { recursive: true });
  writeFileSync(join(outDir, 'task.toml'), `id = "${t.id}"\nslice = "${SET_T_SLICE}"\ntime_budget_s = ${timeBudgetS}\n`);
  writeFileSync(join(outDir, 'grader', 'check.sh'), '#!/usr/bin/env bash\n# Set T: runner/trial/set-t.ts grades the workspace with scripts/skill-resolver/check-set-t.ts after the run.\necho "graded by runner/trial/set-t.ts"\nexit 0\n', { mode: 0o755 });
  return outDir;
}

/** The task the serve entry runs for OpenClaw, Claude Code, Codex and Hermes, whose skill arms are wired there only
 *  (scripts/skill-resolver/ARMS.md): <outDir>/task.toml, one DM turn from SET_T_ACTOR with the request verbatim and no
 *  predicates, and <outDir>/workspace, start/ plus instruction.md, which the runner copies into the trial's workspace (mounted
 *  at /workspace, the adapter's working directory) before the harness starts. Returns outDir. */
export function writeServeSetTTask(taskDir: string, outDir: string, timeBudgetS = SET_T_TIME_BUDGET_S): string {
  const t = loadSetTTask(taskDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(join(taskDir, 'start'), join(outDir, 'workspace'), { recursive: true });
  writeFileSync(join(outDir, 'workspace', 'instruction.md'), t.request);
  writeFileSync(join(outDir, 'task.toml'), [`id = "${t.id}"`, `slice = "${SET_T_SLICE}"`, 'split = "dev"', `time_budget_s = ${timeBudgetS}`, `actors = ["${SET_T_ACTOR}"]`, '',
    '[[turns]]', `actor = "${SET_T_ACTOR}"`, 'channel = "dm"', `text = ${JSON.stringify(t.request)}`, '', '[predicates]', 'required = []', 'forbidden_effects = []', ''].join('\n'));
  return outDir;
}

/** What an adapter itself writes into the workspace on the serve entry, left out of grading unless start/ has it: OpenClaw
 *  installs the catalog at /workspace/skills (harnesses/openclaw/adapter.sh). */
export function adapterWorkspaceEntries(harness: string, taskDir: string): string[] {
  return harness === 'openclaw' && !existsSync(join(taskDir, 'start', 'skills')) ? ['skills'] : [];
}

/** Grades a finished trial workspace. instruction.md is left out of the graded copy when it still holds the request byte for
 *  byte (run-trial.sh or the serve seed put it there); an instruction.md the agent changed stays in, as the agent's own output.
 *  exclude: top-level entries the adapter wrote (adapterWorkspaceEntries), also left out. */
export function gradeSetTWorkspace(taskDir: string, workspace: string, arm: string | null, exclude: string[] = []): TrialSetT {
  const t = loadSetTTask(taskDir);
  const instructionPath = join(workspace, 'instruction.md');
  const instruction: TrialSetT['instruction_md'] = !existsSync(instructionPath) ? 'absent' : readFileSync(instructionPath, 'utf8') === t.request ? 'seeded' : 'changed';
  const copy = mkdtempSync(join(tmpdir(), 'sett-grade-'));
  try {
    cpSync(workspace, copy, { recursive: true });
    if (instruction === 'seeded') rmSync(join(copy, 'instruction.md'));
    for (const e of exclude) rmSync(join(copy, e), { recursive: true, force: true });
    const v = grade(copy, t);
    return {
      task: t.id, target: t.target.name, pack: t.target.pack, skill_md_sha256: t.target.skill_md_sha256, arm,
      request_sha256: sha(t.request), success: v.success, used_it: v.used_it, instruction_md: instruction,
      checks: t.checks.map((c) => ({ id: c.id, pass: !v.failed.includes(c.id), used_it: t.used_it.includes(c.id) })),
    };
  } finally { rmSync(copy, { recursive: true, force: true }); }
}

/** QM only: its agent works in a sandbox container at /root/workspace, not in the task container's /workspace, so the
 *  run task's workspace (start/ plus instruction.md) is baked into a sandbox image on top of base (harnesses/qm/Dockerfile.sett).
 *  The tag names the base image id and the files, so a rerun reuses it. Returns the tag for QM_SANDBOX_IMAGE. */
export function qmSandboxImage(runTask: string, repoRoot: string, base = 'harness-eval/qm-sandbox:dev'): string {
  const baseId = spawnSync('docker', ['image', 'inspect', '-f', '{{.Id}}', base], { encoding: 'utf8' });
  if (baseId.status !== 0) throw new RunnerError('HE-RUN-006', `the QM sandbox image ${base} is missing; fix: docker build -f harnesses/qm/Dockerfile.sandbox -t ${base} harnesses/qm`);
  const context = mkdtempSync(join(tmpdir(), 'sett-qm-'));
  try {
    cpSync(join(runTask, 'workspace'), context, { recursive: true });
    cpSync(join(runTask, 'instruction.md'), join(context, 'instruction.md'));
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
    const files = walk(context).map((p) => p.slice(context.length + 1) + '\0' + sha(readFileSync(p))).sort();
    const tag = 'harness-eval/qm-sandbox:sett-' + sha(baseId.stdout.trim() + '\n' + files.join('\n')).slice(0, 12);
    if (spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' }).status === 0) return tag;
    const b = spawnSync('docker', ['build', '-q', '-f', join(repoRoot, 'harnesses', 'qm', 'Dockerfile.sett'), '--build-arg', 'BASE=' + base, '-t', tag, context], { encoding: 'utf8' });
    if (b.status !== 0) throw new RunnerError('HE-RUN-006', `building the set T QM sandbox image ${tag} failed: ${(b.stderr || b.stdout).trim().slice(-400)}`);
    return tag;
  } finally { rmSync(context, { recursive: true, force: true }); }
}

/** The environment a set T cell adds to the run (opt-in run-trial.sh --env): the arm and the cell's config, when set. */
export function setTEnv(cell: { skill_arm?: string; config?: string }): Record<string, string> {
  return { ...(cell.skill_arm ? { HE_SKILL_ARM: cell.skill_arm } : {}), ...(cell.config ? { HE_HARNESS_CONFIG: cell.config } : {}) };
}
