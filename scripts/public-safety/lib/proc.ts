// Bounded execution for every process the gate starts (plan R2). Each spawn has a deadline; on expiry the whole process
// group is killed and the call throws PsError PS-TOOL-TIMEOUT. Synchronous calls run under GNU timeout, which puts the
// tool in its own process group and signals that group; asynchronous calls start a detached group and kill it by pid.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export class PsError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const GNU_TIMEOUT = ['/usr/bin/timeout', '/bin/timeout'].find((p) => existsSync(p));

export interface RunOptions { op: string; timeoutMs: number; env: Record<string, string>; cwd?: string; input?: string | Buffer; maxBuffer?: number }
export interface RunResult { status: number; stdout: Buffer; stderr: Buffer }

export function runSync(argv: string[], o: RunOptions): RunResult {
  const secs = Math.max(1, Math.ceil(o.timeoutMs / 1000));
  const cmd = GNU_TIMEOUT ? [GNU_TIMEOUT, '--kill-after=2', secs + 's', ...argv] : argv;
  const started = Date.now();
  const r = spawnSync(cmd[0]!, cmd.slice(1), { env: o.env, cwd: o.cwd, input: o.input, maxBuffer: o.maxBuffer ?? 256 * 2 ** 20, timeout: secs * 1000 + 5000, killSignal: 'SIGKILL' });
  const elapsed = Date.now() - started;
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ETIMEDOUT' || (GNU_TIMEOUT && (r.status === 124 || (r.status === 137 && elapsed >= secs * 1000)))) throw new PsError('PS-TOOL-TIMEOUT', o.op + ' did not finish within ' + secs + ' s; its process group was killed');
  if (r.error) throw new PsError('PS-INTERNAL', o.op + ' could not run (' + (code ?? 'error') + ')');
  return { status: r.status ?? 128, stdout: r.stdout ?? Buffer.alloc(0), stderr: r.stderr ?? Buffer.alloc(0) };
}

// A detached child whose group is killed on the deadline; callers read its streams and await done.
export function spawnBounded(argv: string[], o: Omit<RunOptions, 'input' | 'maxBuffer'>) {
  const p = spawn(argv[0]!, argv.slice(1), { env: o.env, cwd: o.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let timedOut = false;
  const kill = () => { try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* already gone */ } };
  const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs);
  const done = new Promise<number>((resolve) => p.on('close', (c, s) => { clearTimeout(timer); resolve(c ?? (s ? 128 : 1)); }));
  p.on('error', () => {});
  return { p, kill, done, timedOut: () => timedOut, timeoutError: () => new PsError('PS-TOOL-TIMEOUT', o.op + ' did not finish within ' + Math.ceil(o.timeoutMs / 1000) + ' s; its process group was killed') };
}
