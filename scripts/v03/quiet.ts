// Run a command over held-out material without letting its output reach a transcript. The child's stdout and
// stderr go to a log file under --log-dir; this wrapper prints only the exit code and the child's own V03: summary
// lines that pass a strict character and shape check (opaque ids, counts, digests, flag codes). Anything else,
// including a V03: line carrying other text, is dropped and counted.
//
//   bun scripts/v03/quiet.ts --log-dir ~/.capy/work/v03/logs [--marker-file <file>] -- <command> [args...]
//
// --marker-file names a file of strings (one per line, for example the set's hidden facts and member names) that
// must never be printed; a passing line containing one is dropped too.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { insideCheckout } from './paths.ts';

const FAMILIES = 'scope_isolation|shared_channel|synthesis|continuity|corrections|approval_relay|expired_recall|memory_scope|session_synthesis|retired_record';
const FAMILY = '(' + FAMILIES + ')';
/** The words the v0.3 and v0.4 tools print: their verbs, opaque ids (hx-NN-xxxxxx, rx-NN-xxxxxx) and their error codes. */
const SAFE_WORD = new RegExp('^(V03:|V04:|task|ok|FLAG|error|audit|audited|checked|excluded|selected|generated|indexed|quiet|world|[hr]x-\\d{2}-[a-z0-9]{6}|(GEN|AUDIT|SELECT|QUIET|CHECK)-[A-Z0-9_-]+(:' + FAMILY + ':\\d+)?)$');
/** The flag codes check-set, the audit and select print, alone or comma-separated. */
const SAFE_CODES = new Set(['PARSE', 'ORACLE_FAILS', 'ORACLE_UNAVAILABLE', 'ORACLE_NO_READ', 'MUTATION_WRONG', 'MUTATION_MISSING', 'ACTOR_UNKNOWN',
  'CHANNEL_SCOPE', 'HIDDEN_IN_CORPUS', 'ANSWER_NOT_VISIBLE', 'BAIT_VISIBLE', 'BAIT_NOT_IN_BRAIN', 'SPEC_MISSING', 'AMBIGUOUS_ASK',
  'ANSWER_NOT_SUPPORTED', 'PATTERN_REJECTS_CORRECT', 'PATTERN_ACCEPTS_WRONG', 'UNFAIR_PENALTY', 'INCOHERENT', 'AUDIT_UNPARSEABLE',
  'SURPLUS', 'CHECK_MISSING', 'AUDIT_MISSING', 'LADDER_MISMATCH', 'SESSIONS_MISMATCH', 'SLUG_MISSING', 'FACT_NOT_CARRIED', 'FACT_IN_WORLD', 'FACT_READABLE',
  'SESSION_SHARED', 'NO_REFERENCE_ROUTE', 'ROUTE_OUT_OF_SCOPE', 'READ_EVERYTHING_PASSES']);
/** The keys of their key=value words. */
const SAFE_KEYS = new Set(['tasks', 'flagged', 'families', 'difficulty', 'seed_commitment', 'kept', 'replacements', 'shortfall', 'calls', 'cache_hits',
  'usd', 'facts', 'exit', 'levels', 'dropped_lines', 'log', 'pages_heldout', 'retries', 'fallbacks', 'spend_usd', 'world_sha', 'facts_sha']);
/** A value: a count, an amount, a digest, a timestamp, none, or counts per family or difficulty. */
const COUNTED = '(' + FAMILIES + '|easy|medium|hard|L[1-4])=\\d+';
const SAFE_VALUE = new RegExp('^(\\d+(\\.\\d+)?|[0-9a-f]{12,64}|\\d{4}-\\d{2}-\\d{2}T[0-9-]+Z|none|null|' + COUNTED + '(,' + COUNTED + ')*)$');

const safeWord = (w: string) => {
  const eq = w.indexOf('=');
  if (eq >= 0) return SAFE_KEYS.has(w.slice(0, eq)) && SAFE_VALUE.test(w.slice(eq + 1));
  return SAFE_WORD.test(w) || w.split(',').every((c) => SAFE_CODES.has(c));
};

export function safeLine(line: string, markers: string[]): boolean {
  if (!/^V0[34]: /.test(line) || line.length > 400) return false;
  if (!line.split(' ').every(safeWord)) return false;
  const low = line.toLowerCase();
  return !markers.some((m) => m.length >= 3 && low.includes(m.toLowerCase()));
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  const opts = argv.slice(0, sep < 0 ? argv.length : sep);
  const cmd = sep < 0 ? [] : argv.slice(sep + 1);
  const opt = (k: string) => { const i = opts.indexOf('--' + k); return i >= 0 ? opts[i + 1] : undefined; };
  const logDir = opt('log-dir');
  if (!logDir || !cmd.length) { console.log('V03: error QUIET-USAGE'); process.exit(2); }
  if (insideCheckout(logDir)) { console.log('V03: error QUIET-LOG-INSIDE-CHECKOUT'); process.exit(2); }
  const markers = opt('marker-file') ? readFileSync(opt('marker-file')!, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : [];
  mkdirSync(logDir, { recursive: true });
  const proc = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe', env: process.env });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = proc.stdout.toString(), err = proc.stderr.toString();
  writeFileSync(join(logDir, stamp + '.log'), '$ ' + cmd.join(' ') + '\n--- stdout\n' + out + '\n--- stderr\n' + err);
  let dropped = 0;
  for (const line of (out + '\n' + err).split('\n')) {
    if (!line.trim()) continue;
    if (safeLine(line, markers)) console.log(line); else dropped++;
  }
  console.log('V03: quiet exit=' + proc.exitCode + ' dropped_lines=' + dropped + ' log=' + stamp);
  process.exit(proc.exitCode ?? 1);
}
