// A restart_before turn whose restart fails (week events, docs/tasks.md): the turn loop ends harness_gone and says who the
// failure is charged to. The harness's own exit (a crash before ready, a busy host port with no exit) counts against the
// harness, its exit 3 against the model, and only a failed docker CLI call is infra. Keyless: an in-process world and a host
// harness stub whose restart() throws.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TurnRequest } from '../runner/contracts.ts';
import { HarnessGone, responseFile, writeAtomic, type Harness } from '../runner/trial/harness.ts';
import { loadTask } from '../runner/trial/task.ts';
import { classify } from '../runner/trial/trial.ts';
import { runTurns } from '../runner/trial/turns.ts';
import { TrialWorld } from '../runner/trial/world.ts';

const TASK = resolve(import.meta.dir, 'fixtures', 'timer-tasks', 'fx-01-timers');

async function failedRestart(gone: HarnessGone) {
  const tmp = mkdtempSync(join(tmpdir(), 'he-restart-fail-'));
  const turnsDir = join(tmp, 'turns');
  mkdirSync(turnsDir);
  const loaded = loadTask(TASK);
  const task = { ...loaded, turns: loaded.turns.slice(0, 2).map((t, i) => (i === 1 ? { ...t, restart_before: true as const } : t)) };
  const tw = new TrialWorld({ trialId: 'restart-fail', split: 'dev', actors: task.actors, outDir: tmp, reachableFromContainers: false, timers: true });
  const answer = (req: TurnRequest) => writeAtomic(join(turnsDir, responseFile(req.turn)), JSON.stringify({ turn: req.turn, exit: 0, reply_text: 'Will do.', started_at: 'x', ended_at: 'y' }));
  const harness: Harness = { kind: 'process', waitReady: async () => undefined, exited: async () => null, notify: answer, stop: async () => undefined, kill: async () => undefined,
    restart: async () => { throw gone; } };
  try {
    const res = await runTurns({ task, preamble: '{{message}}', world: tw, harness, turnsDir, trialId: 'restart-fail', graceS: 0, log: () => {}, restart: { graceMs: 0, readyTimeoutMs: 0 } });
    return { res, termination: classify(res.windows.map((w) => w.exit), null, res.ended_early, false, res.restart_failure) };
  } finally { tw.stop(); rmSync(tmp, { recursive: true, force: true }); }
}

describe('a failed restart', () => {
  test('the harness crashing before ready on restart (exit 1) is a harness error, not infra', async () => {
    const { res, termination } = await failedRestart(new HarnessGone(1, 'the harness exited 1 before writing ready'));
    expect(res.ended_early).toBe('harness_gone');
    expect(res.windows.map((w) => [w.turn, w.exit])).toEqual([[1, 0]]);
    expect(res.restart_failure).toBe('harness');
    expect(termination).toBe('harness_error');
  });
  test('a host port still in use (no exit) is a harness error', async () => {
    expect((await failedRestart(new HarnessGone(null, 'port 58080 of core was still in use'))).termination).toBe('harness_error');
  });
  test('the harness exiting 3 on restart is a model error', async () => {
    expect((await failedRestart(new HarnessGone(3, 'the harness exited 3 before writing ready'))).termination).toBe('model_error');
  });
  test('a failed docker CLI call on restart is an infra error, whatever its status', async () => {
    expect((await failedRestart(new HarnessGone(1, 'docker compose start of core failed on restart 1', true))).termination).toBe('infra_error');
    expect((await failedRestart(new HarnessGone(2, 'docker run failed on restart 1', true))).termination).toBe('infra_error');
  });
});
