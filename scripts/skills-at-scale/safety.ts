// Static safety checks for the skills-at-scale catalog (internal-task, plan finding F11): which files in an added skill folder are
// executables (left out of the snapshot and listed), which lines tell the agent to fetch and run something (reported by
// skill for review, never removed), and the leak scans over the finished snapshot. Used by build-ladder.ts.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanText as tokenScan, type Hit as TokenHit } from '../publish-audit.ts';
import { scan as setRScan } from '../skill-resolver/leak-scan.ts';
import { gitleaks, readLock, readyTool } from '../public-safety/lib/tools.ts';

export const EXECUTABLE_EXTENSIONS = ['sh', 'bash', 'zsh', 'fish', 'ksh', 'csh', 'py', 'pyw', 'pyc', 'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'rb', 'pl', 'pm', 'php', 'lua', 'r', 'ps1', 'psm1', 'bat', 'cmd', 'vbs', 'command', 'applescript', 'scpt', 'exe', 'dll', 'so', 'dylib', 'jar', 'class', 'wasm', 'bin', 'run', 'msi', 'deb', 'rpm', 'apk', 'appimage'];
const MARKDOWN = /\.(md|mdx|markdown)$/i;

export function executableReason(path: string, buf: Buffer, mode: number): string | null {
  if (MARKDOWN.test(path)) return null;
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  if (ext && EXECUTABLE_EXTENSIONS.includes(ext)) return 'script or binary extension .' + ext;
  if (buf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'ELF binary';
  if (buf.subarray(0, 2).toString('latin1') === 'MZ') return 'Windows binary';
  if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(buf.subarray(0, 4).toString('hex'))) return 'Mach-O or Java binary';
  if (buf.subarray(0, 2).toString('latin1') === '#!') return 'shebang line';
  if (mode & 0o111) return 'executable bit set';
  return null;
}

export const FETCH_AND_RUN: Record<string, RegExp> = {
  curl: /\bcurl\b/i,
  wget: /\bwget\b/i,
  pipe_to_shell: /\|\s*(sudo\s+)?(ba|z|k)?sh\b|\|\s*(sudo\s+)?python3?\b|\|\s*iex\b/i,
  pip_install: /\bpip[3x]?\s+(install|run)\b|\buv\s+pip\s+install\b|\buvx\b/i,
  npx: /\bnpx\b|\bbunx\b|\bpnpm\s+dlx\b|\byarn\s+dlx\b/i,
  package_install: /\b(npm|pnpm|yarn|bun)\s+(install|add|i)\b|\b(brew|apt-get|apt|cargo|go|gem)\s+install\b/i,
  base64: /\bbase64\b|\batob\s*\(|\bb64decode\b|FromBase64String/i,
  eval: /\beval\b|\bexec\s*\(/i,
  shell_c: /\b(ba|z)?sh\s+-c\b/i,
  powershell: /\b(invoke-expression|invoke-webrequest|iwr|irm)\b|powershell(\.exe)?\s+-(e|enc|encodedcommand)\b/i,
  chmod_exec: /\bchmod\s+([ugoa]*\+[rw]*x|[0-7]?[0-7][1357][0-7]?)\b/i,
  git_clone: /\bgit\s+clone\b/i,
  docker_run: /\bdocker\s+run\b/i,
  sudo: /\bsudo\b/i,
};

export type LineHit = { line: number; patterns: string[] };
export function fetchAndRunLines(text: string): LineHit[] {
  const out: LineHit[] = [];
  text.split('\n').forEach((l, i) => {
    const patterns = Object.entries(FETCH_AND_RUN).filter(([, re]) => re.test(l)).map(([k]) => k);
    if (patterns.length) out.push({ line: i + 1, patterns });
  });
  return out;
}

export function* walkFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(p); else if (e.isFile()) yield p;
  }
}

export type LeakScan = {
  token_shapes: { files: number; hits: { pattern: string; path: string }[]; allowlisted: number };
  gitleaks: { run: false; reason: string } | { run: true; version: string; findings: { rule: string; path: string; line?: number }[] } | { run: true; error: string };
  set_r: { run: false; reason: string } | { run: true; messages: number; hits: { path: string; id: string; kind: string; count: number }[] };
};

export function leakScan(root: string, opts: { gitleaks?: { cache: string; work: string }; setR?: string }): LeakScan {
  const files = [...walkFiles(root)];
  const hits: TokenHit[] = [];
  const counts: Record<string, number> = {};
  for (const f of files) tokenScan(readFileSync(f).toString('latin1'), relative(root, f), hits, counts);
  const allowlisted = Object.entries(counts).filter(([k]) => k.startsWith('allowlisted:')).reduce((n, [, v]) => n + v, 0);
  const out: LeakScan = {
    token_shapes: { files: files.length, hits: hits.map((h) => ({ pattern: h.pattern, path: h.where })), allowlisted },
    gitleaks: { run: false, reason: 'not requested (--gitleaks)' },
    set_r: { run: false, reason: 'no set R file given (--leak-set); set R is not on this machine' },
  };
  if (opts.gitleaks) {
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
    const lockDir = join(import.meta.dir, '..', 'public-safety');
    const tool = readyTool('gitleaks', readLock(join(lockDir, 'tools.lock')).tools.gitleaks!, { cache: opts.gitleaks.cache, dest: join(opts.gitleaks.work, 'bin'), env });
    const r = gitleaks(tool, root, join(lockDir, 'gitleaks.toml'), opts.gitleaks.work, env);
    out.gitleaks = r.ok
      ? { run: true, version: tool.version, findings: r.findings.map((f) => ({ rule: f.rule, path: relative(root, f.file.startsWith('/') ? f.file : join(root, f.file)), line: f.line })).sort((a, b) => a.path.localeCompare(b.path, 'en') || (a.line ?? 0) - (b.line ?? 0)) }
      : { run: true, error: r.error ?? 'gitleaks failed' };
  }
  if (opts.setR) {
    const rows = readFileSync(opts.setR, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const bodies = files.filter((f) => statSync(f).size <= 64 * 1024 * 1024).map((f) => ({ path: relative(root, f), body: readFileSync(f, 'utf8') }));
    out.set_r = { run: true, messages: rows.length, hits: setRScan(rows, bodies) };
  }
  return out;
}

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
