// The real runner over a throwaway preregistration, for the week tests: tests/week-rig.test.ts (the fake harness and the
// restart lanes, which start the metering proxy) and tests/week-tasks.test.ts (the scripted week tasks, which do not).
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { buildManifest, loadPrereg, type Cell, type Prereg } from '../../runner/run.ts';
import { executeRun } from '../../runner/trial/run.ts';

export const ROOT = resolve(import.meta.dir, '..', '..');
const WEEK_PREAMBLE = join(ROOT, 'tasks', 'multiuser', '_shared', 'preamble.week.md');
export const cleanEnv = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir() };
const PROXY_ENV = { ...cleanEnv, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' };

let runs = 0;
export async function runWeek(tmp: string, cells: Cell[], tasksRoot: string, grade: Parameters<typeof executeRun>[2]['grade'], over: Partial<Parameters<typeof executeRun>[2]> = {}) {
  const runId = `week-${++runs}-${process.pid}`;
  const dir = join(tmp, runId);
  mkdirSync(dir, { recursive: true });
  const prereg: Prereg = { schema_version: 1, run_id: runId, question: 'week events', tasks: {}, cells, wall_clock_s: { multiuser: 600 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify(prereg));
  const { prereg: p, sha256 } = loadPrereg(join(dir, 'prereg.json'));
  const manifest = buildManifest(p, sha256, '2026-11-21T00:00:00Z', { tasksRoot });
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const lines: string[] = [];
  const result = await executeRun(manifest, manifestPath, { harnessMode: cells[0]!.harness_mode === 'scripted' ? 'scripted' : 'process', preamblePath: WEEK_PREAMBLE, grade, proxyEnv: PROXY_ENV, leaseUsd: 1, newLease: true,
    turnGraceS: 5, stopGraceS: 5, readyTimeoutS: 30, repoRoot: ROOT, log: (l) => lines.push(l), ...over });
  return { records: result.records as TrialRecord[], lines };
}
