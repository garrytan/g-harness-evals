#!/usr/bin/env bun
// One keyless serve-entry session of a skills-at-scale arm (internal-task-a, internal-task-b): a real trial through the runner, the metering
// proxy with the capture dummy keys and the repository's fake model endpoint (scripts/gsta-135/fake-anthropic.ts on the Messages
// wire, tests/fixtures/fake-responses.ts on the Responses wire), one multi-user task whose turns are the given texts as DMs from
// one member, so every turn lands in one session. The fake plays an optional script (its --script turns) and then answers "ok".
// No key, no provider, no spend. Used by listing-map.ts, checks.ts and the Pi trace fixture.
//
//   bun scripts/skills-at-scale/session.ts --harness <h> --config <config> --image <tag> --out <dir> --turn <text> [--turn <text>]...
//       [--model <provider:model>] [--script <file.json>] [--preamble <file>]
//
// Writes <out>/fake.ndjson (every request the harness sent), <out>/run/ (the runner's results, the trial's logs and state)
// and <out>/session.json (what ran and where the trial directory is).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GradeResult } from '../../runner/contracts.ts';
import { buildManifest, loadPrereg } from '../../runner/run.ts';
import { CAPTURE_DUMMY_KEYS } from '../../runner/trial/capture.ts';
import { executeRun } from '../../runner/trial/run.ts';
import { ACTOR, readLog, writeSessionTask, type LogRow } from '../skill-resolver/footprint.ts';

const ROOT = resolve(import.meta.dir, '../..');
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
/** Each harness's model in the keyless sessions: the model its counted cells run, on the wire its fake speaks. */
export const SESSION_MODEL: Record<string, string> = { 'claude-code': 'anthropic:claude-opus-5-5', codex: 'openai:gpt-6.2-sol', hermes: 'anthropic:claude-opus-5-5', openclaw: 'anthropic:claude-opus-5-5', pi: 'anthropic:claude-opus-5-5' };
export type FakeTurn = Record<string, unknown>;

async function waitFor(ok: () => boolean, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (ok()) return; await Bun.sleep(200); }
  throw new Error('timed out waiting for ' + what);
}

async function startFake(provider: 'anthropic' | 'openai', dir: string, script: FakeTurn[]) {
  writeFileSync(join(dir, 'script.json'), JSON.stringify(script));
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port as number;
  probe.stop(true);
  const out = openSync(join(dir, 'fake.out'), 'a');
  const proc = spawn(process.execPath, [join(ROOT, provider === 'anthropic' ? 'scripts/gsta-135/fake-anthropic.ts' : 'tests/fixtures/fake-responses.ts'), '--host', '127.0.0.1', '--port', String(port),
    '--log', join(dir, 'fake.ndjson'), '--script', join(dir, 'script.json'), '--require-key-prefix', CAPTURE_DUMMY_KEYS[provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'],
    '--max-requests', '400', '--max-seconds', '3600'], { env: ENV, stdio: ['ignore', out, out] });
  await waitFor(() => readFileSync(join(dir, 'fake.out'), 'utf8').includes('listening'), 20_000, 'the fake model endpoint');
  return { port, stop: () => proc.kill('SIGTERM') };
}

/** The trial directory under a run directory: the one whose logs/ holds ready. */
export function trialDir(runDir: string): string | null {
  let found: string | null = null;
  const walk = (d: string, depth: number) => {
    if (found || depth > 6 || !existsSync(d)) return;
    if (existsSync(join(d, 'logs', 'ready')) || existsSync(join(d, 'logs', 'adapter.log'))) { found = d; return; }
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && e.name !== 'state' && e.name !== 'workspace') walk(join(d, e.name), depth + 1);
  };
  walk(join(runDir, 'trials'), 0);
  return found;
}

export type Session = { dir: string; requests: LogRow[]; trial: string | null; termination: string | null; record: Record<string, unknown> };

export async function runSession(o: { harness: string; config: string; image: string; turns: string[]; dir: string; model?: string; script?: FakeTurn[]; timeBudgetS?: number; preamble?: string }): Promise<Session> {
  const model = o.model ?? SESSION_MODEL[o.harness]!;
  const provider = model.slice(0, model.indexOf(':')) as 'anthropic' | 'openai';
  rmSync(o.dir, { recursive: true, force: true });
  mkdirSync(o.dir, { recursive: true });
  const tasksRoot = join(o.dir, 'tasks');
  const taskId = 'sas-session-' + o.turns.length;
  writeSessionTask(o.turns.map((text, i) => ({ turn: i + 1, id: 't' + (i + 1), text })), join(tasksRoot, 'multiuser', 'dev', taskId), o.timeBudgetS ?? 300);
  const fake = await startFake(provider, o.dir, o.script ?? []);
  try {
    const runId = ('sas-session-' + o.harness + '-' + o.config + '-' + Date.now().toString(36)).toLowerCase();
    const cell = { id: o.harness + '-' + o.config, harness: o.harness, model, slice: 'multiuser', split: 'dev', config: o.config, tasks: [taskId], repetitions: 1,
      ceiling: { input_tokens: 2_000_000, output_tokens: 40_000 }, ...(o.harness === 'codex' ? { network: 'internal' } : {}), ...(o.preamble ? { preamble: o.preamble } : {}) };
    writeFileSync(join(o.dir, 'prereg.json'), JSON.stringify({ schema_version: 1, run_id: runId, question: 'internal-task skills-at-scale keyless session: uncounted, against a fake model endpoint', tasks: {}, cells: [cell], wall_clock_s: { multiuser: 3600 }, spend_cap_usd: 50, drop_order: [], minimum_v01: [] }, null, 1));
    const { prereg, sha256: preregSha } = loadPrereg(join(o.dir, 'prereg.json'));
    const runDir = join(o.dir, 'run');
    mkdirSync(runDir, { recursive: true });
    const manifestPath = join(runDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(buildManifest(prereg, preregSha, new Date().toISOString(), { tasksRoot }), null, 1));
    const grade = (): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const result = await executeRun(manifest, manifestPath, { harnessMode: 'docker', image: o.image, grade, proxyEnv: ENV, repoRoot: ROOT, leaseUsd: 50, newLease: true, maxOutputTokens: 128_000,
      capture: { upstream: { [provider]: 'http://127.0.0.1:' + fake.port }, dns: null }, log: (l) => writeFileSync(join(o.dir, 'progress.log'), l + '\n', { flag: 'a' }) });
    const record = result.records[0] as unknown as Record<string, unknown>;
    const trial = trialDir(runDir);
    const s: Session = { dir: o.dir, requests: readLog(join(o.dir, 'fake.ndjson')), trial, termination: (record?.termination as string) ?? null, record };
    writeFileSync(join(o.dir, 'session.json'), JSON.stringify({ harness: o.harness, config: o.config, image: o.image, model, turns: o.turns, preamble: o.preamble ?? null, trial, termination: s.termination, requests: s.requests.length, actor: ACTOR }, null, 1) + '\n');
    return s;
  } finally { fake.stop(); }
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const turns = a.flatMap((x, i) => (x === '--turn' && a[i + 1] ? [a[i + 1]!] : []));
  const [harness, config, image, out] = [v('--harness'), v('--config'), v('--image'), v('--out')];
  if (!harness || !config || !image || !out || !turns.length) { console.error('usage: session.ts --harness <h> --config <c> --image <tag> --out <dir> --turn <text>... [--model <p:m>] [--script <file>] [--preamble <file>]'); process.exit(2); }
  const s = await runSession({ harness, config, image, turns, dir: resolve(out), model: v('--model'), script: v('--script') ? JSON.parse(readFileSync(v('--script')!, 'utf8')) : undefined, preamble: v('--preamble') });
  console.log('SESSION ' + harness + ' ' + config + ' termination=' + s.termination + ' requests=' + s.requests.length + ' trial=' + s.trial);
}
