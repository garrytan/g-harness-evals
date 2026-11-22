// The harness side of a trial as the turn loop sees it, whatever runs it: a container (docker.ts), an adapter
// script on this host (process mode, here) or the scripted executor (runner/scripted). All three answer the
// file queue of docs/adapters.md: the runner writes turn-NNNN.request.json, the harness writes
// turn-NNNN.response.json, both whole and renamed into place.

import { existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TurnRequest, TurnResponse } from '../contracts.ts';

export interface TrialDirs {
  root: string;
  workspace: string;
  state: string;
  logs: string;
  turns: string;
}

export function makeTrialDirs(root: string): TrialDirs {
  const dirs = { root, workspace: join(root, 'workspace'), state: join(root, 'state'), logs: join(root, 'logs'), turns: join(root, 'turns') };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  return dirs;
}

export interface Harness {
  readonly kind: 'docker' | 'compose' | 'process' | 'scripted';
  /** Resolves once $HE_LOG_DIR/ready exists; rejects with a HarnessGone when the harness ended first or the timeout passed. */
  waitReady(timeoutMs: number): Promise<void>;
  /** The exit code when the harness process or container has already ended, else null. */
  exited(): Promise<number | null>;
  /** For in-process harnesses: a request file is in place. File-queue harnesses poll and need nothing. */
  notify?(req: TurnRequest): void;
  /** SIGTERM, wait graceMs, SIGKILL; then collect logs. Idempotent. */
  stop(graceMs: number): Promise<void>;
  /** Immediate kill, for a turn past its budget. */
  kill(): Promise<void>;
  /** Week events (a turn with restart_before): end the harness the way stop does, keep its workspace, state and logs, start
   *  it again and wait for the new ready file. Rejects with a HarnessGone when the new start is not ready in time. */
  restart?(graceMs: number, readyTimeoutMs: number): Promise<void>;
}

/** Before a restart: the ready file belongs to the old start, so it moves aside under the restart's number. */
export function clearReady(logs: string, n: number): void {
  const ready = join(logs, 'ready');
  if (existsSync(ready)) renameSync(ready, join(logs, `ready.before-restart-${n}`));
}

export class HarnessGone extends Error {
  constructor(readonly exit: number | null, message: string) { super(message); }
}

export const requestFile = (turn: number) => `turn-${String(turn).padStart(4, '0')}.request.json`;
export const responseFile = (turn: number) => `turn-${String(turn).padStart(4, '0')}.response.json`;

export function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export function writeRequest(turnsDir: string, req: TurnRequest): string {
  const path = join(turnsDir, requestFile(req.turn));
  writeAtomic(path, JSON.stringify(req, null, 1) + '\n');
  return path;
}

/** Read a response the moment it appears; null on timeout; a HarnessGone when the harness died first. */
export async function awaitResponse(turnsDir: string, turn: number, timeoutMs: number, harness: Harness, pollMs = 100): Promise<TurnResponse | null> {
  const path = join(turnsDir, responseFile(turn));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      try { return JSON.parse(text) as TurnResponse; } catch { await Bun.sleep(pollMs); continue; }
    }
    const exit = await harness.exited();
    if (exit !== null) {
      if (existsSync(path)) continue;
      throw new HarnessGone(exit, `the harness ended with exit ${exit} before answering turn ${turn}`);
    }
    await Bun.sleep(pollMs);
  }
  return null;
}

/** Wait for the ready file the way every harness kind does: poll the file, give up when the process is gone. */
export async function pollReady(logs: string, timeoutMs: number, exited: () => Promise<number | null>, pollMs = 100): Promise<void> {
  const ready = join(logs, 'ready');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(ready)) return;
    const exit = await exited();
    if (exit !== null) {
      if (existsSync(ready)) return;
      throw new HarnessGone(exit, `the harness exited ${exit} before writing ${ready}`);
    }
    await Bun.sleep(pollMs);
  }
  throw new HarnessGone(null, `no ${ready} after ${Math.round(timeoutMs / 1000)} s`);
}

// ---- process mode: the adapter script runs on this host ---------------------------------------------

export interface ProcessHarnessOptions {
  /** The adapter: a .sh runs under bash, a .ts or .js under bun, anything else as itself. */
  adapter: string;
  dirs: TrialDirs;
  env: Record<string, string>;
}

export function startProcessHarness(opts: ProcessHarnessOptions): Harness {
  const cmd = opts.adapter.endsWith('.sh') ? ['bash', opts.adapter] : /\.(ts|js|mjs)$/.test(opts.adapter) ? [process.execPath, opts.adapter] : [opts.adapter];
  const out = openSync(join(opts.dirs.logs, 'harness.stdout.log'), 'a');
  const err = openSync(join(opts.dirs.logs, 'harness.stderr.log'), 'a');
  const spawn = () => Bun.spawn([...cmd, 'serve'], {
    stdin: 'ignore', stdout: out, stderr: err,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: opts.dirs.state, ...opts.env },
  });
  let proc = spawn();
  const exited = async () => proc.exitCode ?? (proc.signalCode ? 128 + 15 : null);
  const end = async (graceMs: number) => {
    if (await exited() !== null) return;
    proc.kill('SIGTERM');
    const dead = await Promise.race([proc.exited.then(() => true), Bun.sleep(graceMs).then(() => false)]);
    if (!dead) { proc.kill('SIGKILL'); await proc.exited; }
  };
  let stopped: Promise<void> | null = null;
  let restarts = 0;
  return {
    kind: 'process',
    waitReady: (timeoutMs) => pollReady(opts.dirs.logs, timeoutMs, exited),
    exited,
    stop(graceMs) {
      stopped ??= end(graceMs);
      return stopped;
    },
    async kill() { if (await exited() === null) { proc.kill('SIGKILL'); await proc.exited; } },
    async restart(graceMs, readyTimeoutMs) {
      await end(graceMs);
      clearReady(opts.dirs.logs, (restarts += 1));
      proc = spawn();
      await pollReady(opts.dirs.logs, readyTimeoutMs, exited);
    },
  };
}
