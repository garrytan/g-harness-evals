/**
 * The sealed output guard (internal-task phase 3, docs/sealed-custody.md, "What may print"). Crew threads can read each other's
 * transcripts, so whatever a custody command prints is as good as published. Under a sealed root a command installs this
 * guard first: every line it writes still goes, whole, to a log file under the raw results or the sealed root, but the
 * terminal only gets lines that match the command's allowlist (counts, digests, run and cell ids), with every task id
 * replaced by its opaque id and every string of the sealed tasks, slice and corpus replaced by [sealed]. An error line
 * whose code is not known to carry only paths, digests and counts prints its code, the opaque ids it names and the log
 * file, never its text. Withheld lines are counted and the count is printed at exit; an uncaught error prints
 * HE-SEALED-009 and the log path.
 *
 * Bun's console writes past process.stdout.write, so the guard replaces both the console methods and the two stream
 * writers. A child process that inherits stdio would bypass it; custody commands capture their children instead.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { format } from 'node:util';
import { RunnerError } from '../errors.ts';
import { idValues, quotedLiterals, OPAQUE_SALT_FILE, opaqueId, sealedPaths } from './sealed.ts';
import { heldoutSet } from '../../scripts/seal-heldout.ts';

export interface Redactor {
  /** task id -> opaque id */
  ids: Map<string, string>;
  redact(line: string): string;
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) leaves(x, out);
  return out;
}

/** The task ids, their opaque ids and the sealed strings of a root. publicText is text that is public anyway (the public
 *  world, the preregistration, the set's manifest); a sealed string found in it is not redacted. */
export function sealedRedactor(root: string, set: string, publicText = ''): Redactor {
  const p = sealedPaths(root, set);
  const salt = readFileSync(join(root, OPAQUE_SALT_FILE), 'utf8').trim();
  const tasks = existsSync(p.tasks) ? readdirSync(p.tasks, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
  const ids = new Map(tasks.map((t) => [t, opaqueId(salt, t)]));
  const strings = new Set<string>();
  const add = (s: string, min: number) => { const t = s.trim(); if (t.length >= min && !ids.has(t) && !publicText.includes(t)) strings.add(t); };
  for (const f of files(p.tasks)) {
    const text = readFileSync(f, 'utf8');
    for (const line of text.split('\n')) add(line, 8);
    for (const m of text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) add(m[1]!, 6);
    if (f.endsWith('.json')) { try { for (const s of leaves(JSON.parse(text))) add(s, 6); } catch { /* not JSON; lines and quoted strings cover it */ } }
  }
  if (existsSync(p.slice)) for (const s of leaves(JSON.parse(readFileSync(p.slice, 'utf8')))) add(s, 4);
  for (const f of files(p.corpus)) {
    add(relative(join(p.corpus, 'heldout'), f).replace(/\.md$/, ''), 4);
    for (const line of readFileSync(f, 'utf8').split('\n')) add(line, 8);
  }
  for (const f of files(p.generator)) {
    const text = readFileSync(f, 'utf8');
    for (const line of text.split('\n')) add(line, 8);
    for (const s of quotedLiterals(text)) add(s, 6);
    if (f.endsWith('.json')) { try { for (const s of leaves(JSON.parse(text))) add(s, 6); } catch { /* not JSON; lines and quoted strings cover it */ } }
  }
  for (const f of files(p.extras)) {
    const text = readFileSync(f, 'utf8');
    for (const line of text.split('\n')) add(line, 8);
    if (f.endsWith('.json')) { try { const v = JSON.parse(text); for (const s of leaves(v)) add(s, 6); for (const s of idValues(v)) add(s, 3); } catch { /* not JSON; lines cover it */ } }
  }
  const subs: Array<[string, string]> = [...ids.entries(), ...[...strings].map((s): [string, string] => [s, '[sealed]'])].sort((a, b) => b[0].length - a[0].length);
  return { ids, redact: (line) => { let s = line; for (const [x, y] of subs) if (s.includes(x)) s = s.split(x).join(y); return s; } };
}

/** Codes whose messages carry paths, digests, counts and run or cell ids only. */
const SAFE_CODES = /^(?:WARN: )?HE-(?:SEALED|HELDOUT|BUDGET|PREREG|PIN|PROXY-001|RUN-00[1-5])\b/;
const CODE = /^(?:WARN: )?(HE-[A-Z]+-\d{3})/;

export interface Guard {
  /** Print one line past the allowlist (still redacted and logged); for a command's own summary line. */
  say(line: string): void;
  logFile: string;
}

export function guardOutput(o: { redactor: Redactor; logFile: string; allow: RegExp[]; label: string }): Guard {
  mkdirSync(dirname(o.logFile), { recursive: true, mode: 0o700 });
  appendFileSync(o.logFile, `--- ${o.label} ${new Date().toISOString()} pid ${process.pid}\n`, { mode: 0o600 });
  const real = { out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr) };
  const pending = { out: '', err: '' };
  let withheld = 0;
  const gate = (line: string): string | null => {
    if (!line.trim()) return '';
    if (o.allow.some((re) => re.test(line))) return o.redactor.redact(line);
    const code = CODE.exec(line);
    if (code && SAFE_CODES.test(line)) return o.redactor.redact(line);
    if (code) {
      const named = [...o.redactor.ids].filter(([t]) => line.includes(t)).map(([, id]) => id);
      return `${code[1]} (sealed: the message is withheld from this terminal${named.length ? `; opaque task ids ${named.join(', ')}` : ''}; read it in ${o.logFile} inside custody only)`;
    }
    return null;
  };
  const emit = (stream: 'out' | 'err', text: string) => {
    appendFileSync(o.logFile, text);
    const lines = (pending[stream] + text).split('\n');
    pending[stream] = lines.pop()!;
    for (const line of lines) {
      const shown = gate(line);
      if (shown === null) withheld++;
      else if (shown) real[stream](shown + '\n');
    }
  };
  const writer = (stream: 'out' | 'err') => (chunk: unknown, ...rest: unknown[]) => {
    emit(stream, typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
    const cb = rest.find((x) => typeof x === 'function') as (() => void) | undefined;
    cb?.();
    return true;
  };
  console.log = console.info = console.debug = (...a: unknown[]) => emit('out', format(...a) + '\n');
  console.error = console.warn = (...a: unknown[]) => emit('err', format(...a) + '\n');
  (process.stdout as unknown as { write: unknown }).write = writer('out');
  (process.stderr as unknown as { write: unknown }).write = writer('err');
  process.on('exit', () => {
    for (const s of ['out', 'err'] as const) if (pending[s]) { const shown = gate(pending[s]); if (shown === null) withheld++; else if (shown) real[s](shown + '\n'); pending[s] = ''; }
    if (withheld) real.err(`SEALED: ${withheld} line(s) of task-level output withheld from this terminal; the full log is ${o.logFile} (custody only)\n`);
  });
  const crash = (e: unknown) => {
    appendFileSync(o.logFile, `${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    real.err(`HE-SEALED-009 an unexpected error inside custody; its message and stack are in ${o.logFile} (custody only)\n`);
    process.exit(2);
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  return { say: (line) => { appendFileSync(o.logFile, line + '\n'); real.out(o.redactor.redact(line) + '\n'); }, logFile: o.logFile };
}

/** The public text a redactor leaves alone: whatever of the named files exist. */
export function publicTextOf(paths: string[]): string {
  return paths.filter((p) => existsSync(p) && statSync(p).isFile()).map((p) => readFileSync(p, 'utf8')).join('\n');
}

/** The guard for a custody command run against an opened root, with the public world, the set's manifest and the
 *  preregistration of the checkout at repoRoot left unredacted. */
export function sealedGuard(o: { root: string; set: string; repoRoot: string; preregJson?: string; logFile: string; allow: RegExp[]; label: string }): Guard {
  const pub = publicTextOf([join(o.repoRoot, 'world', 'seed', 'world.json'), heldoutSet(o.set, o.repoRoot).manifest, ...(o.preregJson ? [join(o.repoRoot, o.preregJson)] : [])]);
  let redactor: Redactor;
  try { redactor = sealedRedactor(o.root, o.set, pub); } catch (e) { throw new RunnerError('HE-SEALED-004', `the output guard could not read the sealed root ${o.root} (${e instanceof Error ? e.name : 'error'}); the message is withheld, since it can quote sealed text or a task path; fix: close the root and open the run again (scripts/sealed/open.ts)`); }
  return guardOutput({ redactor, logFile: o.logFile, allow: o.allow, label: o.label });
}
