// The pinned tools (a tools.lock file): each artifact is downloaded once into a cache under a deadline with one bounded
// retry, re-hashed against the lock on every run, and checked for the version it reports before use. gitleaks() runs
// the pinned gitleaks with --redact, so its report never holds a matched value.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PsError, runSync } from './proc.ts';

export interface ToolPin {
  version: string;
  url: string;
  sha256: string;
  archive: 'tar.gz' | 'none';
  member: string;
  version_args: string[];
  version_output: string;
  interpreter?: string;
  git_blob?: string;
}
export interface ToolsLock { schema: string; tools: Record<string, ToolPin> }
export interface ReadyTool { name: string; version: string; sha256: string; argv: string[] }
export interface ToolFinding { rule: string; file: string; line?: number }

export function readLock(path: string): ToolsLock {
  const lock = JSON.parse(readFileSync(path, 'utf8')) as ToolsLock;
  if (lock.schema !== 'harness-evals-tools-lock/1') throw new Error('tools.lock: unknown schema ' + JSON.stringify(lock.schema));
  for (const [name, t] of Object.entries(lock.tools)) {
    if (!/^[0-9a-f]{64}$/.test(t.sha256)) throw new Error('tools.lock: ' + name + ' has no sha256');
    if (!t.version || !(t.url.startsWith('https://') || t.url.startsWith('file://'))) throw new Error('tools.lock: ' + name + ' needs a version and an https url');
  }
  return lock;
}

export const sha256File = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export interface ReadyOptions { cache: string; dest: string; env: Record<string, string>; deadlineMs?: number }

// Download (if absent) into a partial file this call owns, verify the checksum, unpack into dest, and check the reported
// version. A failed or timed-out download is retried once; only the call's own partial file is ever removed.
export function readyTool(name: string, pin: ToolPin, o: ReadyOptions): ReadyTool {
  const cache = join(o.cache, name + '-' + pin.version);
  mkdirSync(cache, { recursive: true });
  const artifact = join(cache, pin.url.split('/').pop()!);
  const deadline = o.deadlineMs ?? 120_000;
  for (let attempt = 1; !existsSync(artifact); attempt++) {
    const part = artifact + '.' + process.pid + '-' + randomBytes(4).toString('hex') + '.part';
    try {
      const secs = Math.max(1, Math.ceil(deadline / 1000));
      const dl = runSync(['curl', '-fsSL', '--connect-timeout', String(Math.min(secs, 20)), '--max-time', String(secs), '-o', part, pin.url], { op: name + ' download', timeoutMs: deadline + 2000, env: o.env });
      if (dl.status !== 0) throw new PsError(dl.status === 28 ? 'PS-TOOL-TIMEOUT' : 'PS-TOOL-DOWNLOAD', name + ': download failed (curl exit ' + dl.status + ')');
      renameSync(part, artifact);
    } catch (e) {
      if (attempt >= 2 || !(e instanceof PsError)) throw e;
    } finally {
      rmSync(part, { force: true });
    }
  }
  const got = sha256File(artifact);
  if (got !== pin.sha256) throw new PsError('PS-TOOL-SHA', name + ' ' + pin.version + ': artifact sha256 ' + got.slice(0, 12) + ' does not match tools.lock ' + pin.sha256.slice(0, 12) + '; refusing to run it');
  mkdirSync(o.dest, { recursive: true });
  const bin = join(o.dest, pin.member);
  if (pin.archive === 'tar.gz') {
    const x = runSync(['tar', '-xzf', artifact, '-C', o.dest, pin.member], { op: name + ' unpack', timeoutMs: 60_000, env: o.env });
    if (x.status !== 0 || !existsSync(bin)) throw new PsError('PS-TOOL-SHA', name + ': ' + pin.member + ' is not in the pinned archive');
  } else {
    copyFileSync(artifact, bin);
  }
  chmodSync(bin, 0o755);
  const argv = pin.interpreter ? [pin.interpreter, bin] : [bin];
  const v = runSync([...argv, ...pin.version_args], { op: name + ' version check', timeoutMs: 30_000, env: o.env });
  const reported = (v.stdout.toString('utf8') + v.stderr.toString('utf8')).trim();
  if (v.status !== 0 || !reported.includes(pin.version_output)) throw new PsError('PS-TOOL-SHA', name + ': reports version ' + JSON.stringify(reported.slice(0, 80)) + ', tools.lock pins ' + pin.version_output);
  return { name, version: pin.version, sha256: got, argv };
}

const glArgs = (config: string, report: string, ignoreDir: string) => ['--config', config, '--redact', '--no-banner', '--ignore-gitleaks-allow', '--gitleaks-ignore-path', ignoreDir, '--report-format', 'json', '--report-path', report, '--exit-code', '0', '--log-level', 'error'];

function glRun(tool: ReadyTool, mode: string[], config: string, work: string, env: Record<string, string>, input: string | undefined, timeoutMs: number): { ok: boolean; findings: ToolFinding[]; error?: string } {
  mkdirSync(work, { recursive: true });
  const report = join(work, 'gitleaks-report-' + randomBytes(4).toString('hex') + '.json');
  const ignoreDir = join(work, 'no-gitleaksignore');
  mkdirSync(ignoreDir, { recursive: true });
  try {
    const r = runSync([...tool.argv, ...mode, ...glArgs(config, report, ignoreDir)], { op: 'gitleaks ' + mode[0], timeoutMs, env, input });
    if (r.status !== 0 || !existsSync(report)) return { ok: false, findings: [], error: 'gitleaks exited ' + r.status };
    const rows = JSON.parse(readFileSync(report, 'utf8')) as { RuleID: string; File: string; StartLine: number }[];
    return { ok: true, findings: rows.map((f) => ({ rule: f.RuleID, file: f.File, line: f.StartLine })) };
  } finally {
    rmSync(report, { force: true });
  }
}

export function gitleaks(tool: ReadyTool, dir: string, config: string, work: string, env: Record<string, string>, timeoutMs = 30 * 60_000): { ok: boolean; findings: ToolFinding[]; error?: string } {
  return glRun(tool, ['dir', dir, '--max-archive-depth', '4'], config, work, env, undefined, timeoutMs);
}

export function gitleaksStdin(tool: ReadyTool, text: string, config: string, work: string, env: Record<string, string>, timeoutMs = 10 * 60_000): { ok: boolean; findings: ToolFinding[]; error?: string } {
  return glRun(tool, ['stdin'], config, work, env, text, timeoutMs);
}

// A tar archive built in memory: the canary container of the scanner self-tests.
export function tarOf(files: { name: string; data: Buffer }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const f of files) {
    const h = Buffer.alloc(512);
    h.write(f.name, 0, 100, 'utf8');
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(f.data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, f.data, Buffer.alloc((512 - (f.data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
