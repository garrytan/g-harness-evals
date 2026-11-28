/**
 * bash 5.2 drops a trap that fires while it parses a $(...): the trap string is parsed inside the command substitution, so
 * `trap 'stopping=1' TERM` never sets its flag, and under set -e the adapter exits 2 instead of stopping (bash 5.3 guards
 * this; no 5.2 patch does). Every bash adapter starts with the same stop supervisor block. As container PID 1, which is how
 * every trial runs an adapter, the block does nothing: the adapter keeps its own trap and the stopping variable, starts no
 * worker and makes no stop file, so in-container kills and stops end a trial exactly as they did. Off PID 1 (the process
 * harness, these tests), the process that gets the signal runs the adapter again as a worker and only waits; once the worker
 * passes its trap line (HE_STOP_FILE.armed), the supervisor's trap writes HE_STOP_FILE, which he_stop_check copies into
 * stopping. This file checks the block and where each adapter uses it, that the worker gets the same arguments, stdin,
 * directory, environment and ignored signals as a plain run, the early-signal, SIGKILL, temp-directory and exit-code cases,
 * an adapter-shaped loop under SIGTERMs at random moments with the old trap and with the supervisor, and, as PID 1 in a PID
 * namespace or a container, that the adapter makes no stop file and that kill -9 -1 and pkill -9 bash from inside end the
 * run the same way as the old trap does. Keyless, scrubbed environment.
 */
import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const ADAPTERS = ['_fake', 'claude-code', 'codex', 'cursor', 'dsh', 'hermes', 'openclaw', 'pi', 'qm'];
const START = '# >>> stop supervisor';
const END = '# <<< stop supervisor\n';
const source = (h: string) => readFileSync(join(ROOT, 'harnesses', h, 'adapter.sh'), 'utf8');
const supervisor = (s: string) => s.slice(s.indexOf(START), s.indexOf(END) + END.length);
const TRAPS = "  trap 'he_signal TERM' TERM; trap 'he_signal INT' INT";
const ARM = 'if [ -n "$' + '{HE_STOP_FILE:-}" ]; then : > "$HE_STOP_FILE.armed"; else ';
const OLD_TRAP = "trap 'stopping=1' TERM INT";
const BASH_52 = /version 5\.2\./.test(spawnSync('bash', ['--version'], { encoding: 'utf8' }).stdout);
const ENV = { PATH: '/usr/bin:/bin' };

describe('the stop supervisor in each bash adapter', () => {
  const block = supervisor(source('_fake'));

  test('the block is there', () => {
    expect(block.startsWith(START)).toBe(true);
    expect(block).toContain(TRAPS);
    expect(block).toContain('if [ "$$" -eq 1 ]; then\n  unset HE_STOP_FILE HE_STOP_SUPERVISOR\n');
  });

  for (const h of ADAPTERS) {
    test(h + ' carries it unchanged right after set -euo pipefail, keeps its own trap for PID 1 and reads stopping only through he_stop_check', () => {
      const s = source(h);
      expect(supervisor(s)).toBe(block);
      expect(s).toContain('\nset -euo pipefail\n\n' + block);
      const rest = s.replace(block, '');
      expect(rest.match(/^\s*trap [^\n]*\b(TERM|INT)\b/gm)).toBeNull();
      const armed = rest.split('\n').filter(l => l.includes(ARM));
      expect(armed).toHaveLength(1);
      expect(armed[0]!.trim()).toMatch(/^if \[ -n "\$\{HE_STOP_FILE:-\}" \]; then : > "\$HE_STOP_FILE\.armed"; else trap 'stopping=1[^\n]*' TERM INT; fi$/);
      expect(rest.replaceAll('{ he_stop_check; [ "$stopping" -eq', '')).not.toContain('[ "$stopping" -eq');
      expect(rest).not.toContain('wait "$tpid"; code=$?\n    if');
    });
  }
});

/** An adapter-shaped script: ready, then a loop of command substitutions and an idle sleep until stopping is set; guard
 *  (' || true') keeps a child killed from inside from ending it under set -e, so the kill tests see only the adapter itself. */
function shaped(head: string, loop = '', check = '[ "$stopping" -eq 0 ]', guard = ''): string {
  return ['set -euo pipefail', '', head, 'echo $$ > "$1/pid"', ': > "$1/ready"', 'while ' + check + '; do',
    '  for i in 1 2 3 4 5 6 7 8; do x="$(printf a)$(printf b)"' + guard + '; done', loop, '  sleep 0.05' + guard, 'done', 'exit 0', ''].join('\n');
}
const OLD = (guard = '') => shaped('stopping=0\n' + OLD_TRAP, '', undefined, guard);
const NEW = (block = supervisor(source('_fake')), guard = '') =>
  shaped(block + 'stopping=0\n' + ARM + OLD_TRAP + '; fi', '', '{ he_stop_check; [ "$stopping" -eq 0 ]; }', guard);

/** Runs the script n times, each SIGTERMed at a random moment after ready, 10 at a time; resolves the runs that did not exit 0. */
async function sigtermRuns(script: string, n: number): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'he-adapter-stop-'));
  const file = join(dir, 'adapter.sh');
  writeFileSync(file, script);
  let bad = 0;
  try {
    for (let i = 0; i < n; i += 10) {
      const runs = Array.from({ length: Math.min(10, n - i) }, async (_, j) => {
        const d = mkdtempSync(join(dir, 'run-' + (i + j) + '-'));
        const child = spawn('bash', [file, d], { env: ENV, stdio: 'ignore' });
        const exited = new Promise<number | null>((res) => child.once('exit', (code) => res(code)));
        while (!existsSync(join(d, 'ready'))) await Bun.sleep(5);
        await Bun.sleep(Math.random() * 100);
        child.kill('SIGTERM');
        const code = await Promise.race([exited, Bun.sleep(5000).then(() => { child.kill('SIGKILL'); return null; })]);
        if (code !== 0) bad++;
      });
      await Promise.all(runs);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad;
}

describe('an adapter-shaped loop off PID 1 under SIGTERM at random moments', () => {
  test.skipIf(!BASH_52)('with the old trap, bash 5.2 loses the stop and the loop does not exit 0', async () => {
    expect(await sigtermRuns(OLD(), 100)).toBeGreaterThan(0);
  }, 120_000);

  test('with the stop supervisor, every run exits 0', async () => {
    expect(await sigtermRuns(NEW(), 60)).toBe(0);
  }, 120_000);

  test('a worker that exits as the supervisor\'s trap runs still gives the supervisor its exit code', async () => {
    const block = supervisor(source('_fake'));
    const slow = block.replace(': > "$HE_STOP_FILE"; else', ': > "$HE_STOP_FILE"; sleep 0.3; else');
    expect(slow).not.toBe(block);
    expect(await sigtermRuns(NEW(slow), 20)).toBe(0);
  }, 120_000);
});

describe('the worker runs as the plain adapter would', () => {
  const probe = ['pwd', 'printf "args:%s|" "$0" "$@"; echo', 'IFS= read -r line; echo "stdin:$line"', 'echo "foo:$HE_PARITY_FOO"',
    "bash -c '[ -n \"$" + "{HE_STOP_FILE+x}\" ] && echo \"child sees HE_STOP_FILE\" || echo \"child does not see HE_STOP_FILE\"'",
    "awk '/^SigIgn/ {print \"child SigIgn \" $2}' /proc/self/status", ''].join('\n');

  function run(script: string, parentIgnoresInt: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'he-adapter-parity-'));
    try {
      const file = join(dir, 'adapter.sh');
      writeFileSync(file, script);
      const cmd = (parentIgnoresInt ? "trap '' INT; " : '') + 'cd "$1" && bash ./adapter.sh serve "two words"';
      const r = spawnSync('bash', ['-c', cmd, '_', dir], { env: { ...ENV, HE_PARITY_FOO: 'bar' }, input: 'first line\nsecond\n', encoding: 'utf8' });
      expect(r.status).toBe(0);
      return r.stdout.replaceAll(dir, '<dir>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  for (const ignored of [false, true]) {
    test('arguments, stdin, directory, environment and ignored signals match' + (ignored ? ', with SIGINT ignored by the parent' : ''), () => {
      const plain = run('set -euo pipefail\n' + probe, ignored);
      const supervised = run('set -euo pipefail\n\n' + supervisor(source('_fake')) + probe, ignored);
      expect(supervised).toBe(plain);
      expect(plain).toContain('stdin:first line\n');
      expect(plain).toContain('child does not see HE_STOP_FILE\n');
      const mask = BigInt('0x' + /child SigIgn ([0-9a-f]+)/.exec(plain)![1]);
      expect(mask & 2n).toBe(ignored ? 2n : 0n);
    });
  }
});

describe('off PID 1, a stop the supervisor does not turn into the stop file ends the run as a plain run would', () => {
  const HAVE_SETPRIV = spawnSync('setpriv', ['--pdeathsig', 'KILL', 'true']).status === 0;
  const early = (head: string) => ['set -euo pipefail', '', head, 'echo $$ > "$1/worker"', 'sleep 30', 'exit 0', ''].join('\n');
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  function started(script: string, env: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'he-adapter-early-'));
    writeFileSync(join(dir, 'adapter.sh'), script);
    const child = spawn('bash', [join(dir, 'adapter.sh'), dir], { env: { ...ENV, ...env }, stdio: 'ignore' });
    const exited = new Promise<{ code: number | null; signal: string | null }>((res) => child.once('exit', (code, signal) => res({ code, signal })));
    return { dir, child, exited };
  }

  test('a SIGTERM before the trap line ends the run at once, as it ended a run with no trap yet', async () => {
    const plain = started(early(''));
    const supervised = started(early(supervisor(source('_fake'))));
    try {
      for (const r of [plain, supervised]) {
        while (!existsSync(join(r.dir, 'worker'))) await Bun.sleep(5);
        r.child.kill('SIGTERM');
      }
      const timeout = Bun.sleep(5000).then(() => null);
      expect(await Promise.race([plain.exited, timeout])).toEqual({ code: null, signal: 'SIGTERM' });
      expect(await Promise.race([supervised.exited, timeout])).toEqual({ code: 143, signal: null });
    } finally {
      for (const r of [plain, supervised]) rmSync(r.dir, { recursive: true, force: true });
    }
  }, 20_000);

  test.skipIf(!HAVE_SETPRIV)('a SIGKILL of the supervisor also ends the worker', async () => {
    const r = started(early(supervisor(source('_fake')) + 'stopping=0\n' + ARM + OLD_TRAP + '; fi'));
    try {
      while (!existsSync(join(r.dir, 'worker'))) await Bun.sleep(5);
      const worker = Number(readFileSync(join(r.dir, 'worker'), 'utf8'));
      expect(alive(worker)).toBe(true);
      r.child.kill('SIGKILL');
      await r.exited;
      for (let i = 0; i < 100 && alive(worker); i++) await Bun.sleep(20);
      expect(alive(worker)).toBe(false);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  }, 20_000);

  test('a temp directory the supervisor cannot use stops the run before the worker starts', async () => {
    const r = started(early(supervisor(source('_fake'))), { TMPDIR: '/nonexistent/he-stop-test' });
    try {
      const exit = await Promise.race([r.exited, Bun.sleep(5000).then(() => null)]);
      expect(exit?.code).not.toBe(0);
      expect(existsSync(join(r.dir, 'worker'))).toBe(false);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  }, 20_000);
});

/**
 * As PID 1 (a trial container, or here a user and PID namespace), with a kill from inside sent after ready: the script
 * writes alive once it sees go, then the outside sends SIGTERM. The loop has no command substitutions here: as PID 1 both
 * sides keep the old trap, which bash 5.2 can lose while parsing one (the random-moment test above covers that race).
 * Resolves what the run left: its PID, whether it was alive after the kill, its exit code and the he-stop entries in its
 * temp directory.
 */
type Pid1 = { pid: string; alive: boolean; code: number | null; stopFiles: string[] };
const KILLS = ['kill -9 -1', 'pkill -9 bash'];
const withKill = (script: string, kill: string) => script.replace(': > "$1/ready"',
  ': > "$1/ready"\n( while [ ! -e "$1/kill" ]; do sleep 0.02; done; ' + kill + ' || true; : > "$1/killed" ) &')
  .replace('  sleep 0.05', '  [ ! -e "$1/go" ] || : > "$1/alive"\n  sleep 0.05')
  .replace(/^ {2}for i in [^\n]*\$\(printf a\)[^\n]*\n/m, '');

async function asPid1(launch: (dir: string) => { child: ReturnType<typeof spawn>; term: () => void }, script: string): Promise<Pid1> {
  const dir = mkdtempSync(join(tmpdir(), 'he-adapter-pid1-'));
  try {
    writeFileSync(join(dir, 'adapter.sh'), script);
    const { child, term } = launch(dir);
    const exited = new Promise<number | null>((res) => child.once('exit', (code) => res(code)));
    const until = async (f: string) => { for (let i = 0; i < 1000 && !existsSync(join(dir, f)); i++) await Bun.sleep(10); };
    await until('ready');
    writeFileSync(join(dir, 'kill'), '');
    await until('killed');
    await Bun.sleep(200);
    writeFileSync(join(dir, 'go'), '');
    await until('alive');
    const alive = existsSync(join(dir, 'alive'));
    term();
    const code = await Promise.race([exited, Bun.sleep(10_000).then(() => { child.kill('SIGKILL'); return null; })]);
    return { pid: readFileSync(join(dir, 'pid'), 'utf8').trim(), alive, code, stopFiles: readdirSync(join(dir, 'tmp')).filter(f => f.startsWith('he-stop')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HAVE_UNSHARE = spawnSync('unshare', ['-Urpf', '--mount-proc', 'true']).status === 0;
const unshared = (dir: string) => {
  spawnSync('mkdir', ['-p', join(dir, 'tmp')]);
  const child = spawn('unshare', ['-Urpf', '--mount-proc', 'bash', join(dir, 'adapter.sh'), dir], { env: { ...ENV, TMPDIR: join(dir, 'tmp') }, stdio: 'ignore' });
  const inner = () => Number(readFileSync('/proc/' + child.pid + '/task/' + child.pid + '/children', 'utf8').trim().split(' ')[0]);
  return { child, term: () => process.kill(inner(), 'SIGTERM') };
};
const IMAGE = 'debian:bookworm-slim';
const HAVE_IMAGE = spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status === 0;
let seq = 0;
const contained = (dir: string) => {
  spawnSync('mkdir', ['-p', join(dir, 'tmp')]);
  spawnSync('chmod', ['-R', 'a+rwx', dir]);
  const name = 'he-adapter-pid1-' + process.pid + '-' + ++seq;
  const child = spawn('docker', ['run', '--rm', '--name', name, '--user', String(process.getuid!()), '-e', 'TMPDIR=' + dir + '/tmp', '-v', dir + ':' + dir,
    '--entrypoint', 'bash', IMAGE, dir + '/adapter.sh', dir], { stdio: 'ignore' });
  return { child, term: () => { spawnSync('docker', ['kill', '-s', 'TERM', name], { stdio: 'ignore' }); } };
};

for (const [where, have, launch] of [['a PID namespace', HAVE_UNSHARE, unshared], ['a container', HAVE_IMAGE, contained]] as const) {
  describe('as PID 1 in ' + where + ', which is how a trial runs the adapter', () => {
    for (const kill of KILLS) {
      test.skipIf(!have)(kill + ' from inside leaves the adapter running, as with the old trap, and it stops on SIGTERM with no stop file', async () => {
        expect(withKill(OLD(' || true'), kill)).not.toContain('$(');
        const old = await asPid1(launch, withKill(OLD(' || true'), kill));
        const neu = await asPid1(launch, withKill(NEW(undefined, ' || true'), kill));
        expect(old).toEqual({ pid: '1', alive: true, code: 0, stopFiles: [] });
        expect(neu).toEqual(old);
      }, 60_000);
    }
  });
}
