/**
 * SIGTERM a bash serve adapter at a moment its `trap 'stopping=1' TERM INT` is safe to run.
 *
 * bash 5.2 (Ubuntu 24.04's 5.2.21, the CI runners' and lane VMs' host bash) runs pending traps at the top of
 * parse_command, which it also reaches while parsing a `$(...)` it is about to expand (xparse_dolparen sets
 * PST_CMDSUBST|PST_EOFTOKEN). A SIGTERM pending at that moment parses the trap's text inside the half-parsed command
 * substitution: bash prints "trap: line 2: unexpected EOF while looking for matching `)'", stopping is never set, the
 * substitution fails, and under set -e the adapter exits 2. bash 5.3 skips run_pending_traps there (bug-bash 2023-09,
 * "Parse error in bash 5.2+ with CHLD trap and 2 or more $() in a command"). A test that sends SIGTERM at an arbitrary
 * moment after the last response hits it about once in a few hundred stops.
 *
 * So the signal goes in while the adapter is held (SIGSTOP) inside its idle poll's foreground `sleep`: bash then runs
 * the trap when that command returns, at execute_command_internal's own run_pending_traps, never inside a parse. Every
 * serve adapter polls with a foreground sleep (sleep 0.25 at the bottom of its serve loop, BASE copies included).
 */
import { readFileSync, readdirSync } from 'node:fs';

function stat(pid: number): { comm: string; state: string; ppid: number } | null {
  let s: string;
  try { s = readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { return null; }
  const [state, ppid] = s.slice(s.lastIndexOf(')') + 2).split(' ');
  return { comm: s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')), state: state!, ppid: Number(ppid) };
}

/** pid's live children named sleep. */
function sleeping(pid: number): boolean {
  return readdirSync('/proc').some(d => {
    if (!/^\d+$/.test(d)) return false;
    const s = stat(Number(d));
    return s !== null && s.ppid === pid && s.comm === 'sleep' && s.state !== 'Z';
  });
}

/** Sends SIGTERM to the adapter at pid once it is held in a foreground sleep; after timeoutMs, sends it anyway. */
export async function termWhenIdle(pid: number, timeoutMs = 10_000): Promise<void> {
  const signal = (sig: NodeJS.Signals) => { try { process.kill(pid, sig); return true; } catch { return false; } };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!signal('SIGSTOP')) return;
    let state = stat(pid)?.state;
    for (let i = 0; i < 200 && state !== undefined && state !== 'T' && state !== 'Z'; i++) { await Bun.sleep(1); state = stat(pid)?.state; }
    const idle = state === 'T' && sleeping(pid);
    if (idle) signal('SIGTERM');
    signal('SIGCONT');
    if (idle || state === undefined || state === 'Z') return;
    await Bun.sleep(20);
  }
  signal('SIGTERM');
}
