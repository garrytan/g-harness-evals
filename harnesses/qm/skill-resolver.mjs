// internal-task skill-resolver arms on QM, adapter side (docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md). Runs in
// the task container beside adapter.sh, and only for the configs pi-skills-native, pi-skills-push and pi-skills-pull
// (prepare.sh), on the run entry (adapter.sh refuses them on serve, which cannot register the world MCP server at this pin);
// every other config never loads this file. The resolver call, its input and the status line are the same as the four push
// harnesses' hook wrapper (scripts/skill-resolver/hook-wrapper.ts, scripts/skill-resolver/ARMS.md), so one analysis reads
// all five harnesses.
//
//   node skill-resolver.mjs turn <shadow|push> <text-in> <text-out> <log-dir> <session-key>
//     Calls the resolver once for the turn and writes one status line. The message ranked is <text-in>, instruction.md:
//     on the run entry that is the member's own request, with no runner preamble (docs/adapters.md), and a run is one
//     turn, so no previous_user_message goes along. shadow (the native arm): --shadow, <text-out> is <text-in> unchanged.
//     push (the "emulated hook" arm): when the result is OK (a non-empty block, no error, no no_skill, budget left),
//     <text-out> is the block, one blank line, then <text-in>. Never fails the turn: a nonzero resolver exit, a timeout
//     or unreadable output is an empty block, and an internal error still writes <text-out> as <text-in>.
//   node skill-resolver.mjs pull <qm-turn.json> <log-dir>
//     The pull arm: reads the turn's stored QM session (GET /v1/admin/sessions/:id?scope=personal:<actor>, saved as
//     <log-dir>/skill-resolver/qm-session.json) and writes one status line per resolve-skills call the model made
//     through execute, because that call runs in QM's sandbox, not here.
//   node skill-resolver.mjs listing <out.json>
//     Every skill arm: the org's installed skills once their count is stable (three equal reads 2 s apart, at most 60 s),
//     so the trial records what QM had to list (the no-catalog arm's remainder included).
//
// The resolver call: <gbrain> skills resolve --catalog he-skills --input-json - --json --session <session-key> --harness qm
// --top-k 5 [--shadow --shadow-log <log-dir>/skill-resolver/shadow.ndjson] --fail-open --expect-catalog <receipt catalog_hash>
// (in shadow mode the release prints a quiet result and logs the one it would have injected, which is the result read), input {message, session_id, harness, top_k,
// exclude, shadow}, under env -i with PATH, HOME, GBRAIN_HOME and GBRAIN_SKILLS_NO_AUTOREBUILD=1. GBRAIN_HOME is a copy of
// the image's index home (QM_SKILL_GBRAIN_HOME, default /opt/skill-resolver/gbrain-home, built in the arm image by
// Dockerfile.arms) under $HOME/he-skills/, so the resolver keeps session state; the receipt stays the image's read-only one.
// Every result and the receipt are read through the tables in scripts/skill-resolver/result-fields.ts, and session_block_tokens,
// budget_phase and block_reason are derived there from the session's earlier status lines (deriveSessionFields).
//
// Per call, <log-dir>/skill-resolver/status.ndjson gets one line with the hook wrapper's fields (code, exit, timing_ms,
// wall_ms, index_stale, index_hash, gbrain_version, catalog_hash, block_sha256, block_bytes, block_tokens, suggestions,
// deduped, no_skill, no_skill_reason, budget_exhausted, session_block_tokens, k, block_reason, budget_phase, injected,
// repeat, infra, infra_reasons, argv, autorebuild_off, error) plus QM's trial, call, label and at, and results.ndjson
// the raw result, the mapped one as fields, and the input sent. A turn is INFRA (reported, intention-to-treat) when the
// result says index_stale, on CATALOG_MISMATCH, when its index_hash or gbrain_version differ from the build receipt, or
// when the receipt cannot be read; the reasons are also merged into <log-dir>/skill-resolver/infra.json, the trial's
// INFRA marker. An empty block because the session's block budget is spent (BUDGET_EXHAUSTED) is a result, not INFRA.
//
// Environment: QM_SKILL_RESOLVER_BIN (default gbrain), QM_SKILL_GBRAIN_HOME, QM_SKILL_RECEIPT (default the index home's
// .gbrain/skill-index/he-skills/receipt.json), QM_SKILL_RESOLVER_TIMEOUT_MS (default 10000), HE_TRIAL_ID, HE_HARNESS_CONFIG;
// pull and listing also read QM_CORE_URL, QM_SIGNING_SECRET, QM_ADMIN_ACTOR, QM_ACTOR_ID and QM_ORG_SCOPE, as adapter.sh
// sets them.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FRESH_SESSION, normalizeReceipt, normalizeResult, receiptPathIn } from '../../scripts/skill-resolver/result-fields.ts';

export const CATALOG = 'he-skills';
export const STATUS_DIR = 'skill-resolver';
export const ARM_LABELS = { shadow: 'native (resolver in shadow)', push: 'emulated hook', pull: 'pull via sandbox tool (QM refuses private-address MCP)' };
const DEFAULT_HOME = '/opt/skill-resolver/gbrain-home';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/** The hook wrapper's resolve command line (hook-wrapper.ts resolveArgv) with harness qm. */
export function resolveArgv(bin, session, expectCatalog, shadow, shadowLog = '') {
  return [bin, 'skills', 'resolve', '--catalog', CATALOG, '--input-json', '-', '--json', '--session', session, '--harness', 'qm', '--top-k', '5',
    ...(shadow ? ['--shadow', '--shadow-log', shadowLog] : []), '--fail-open', '--expect-catalog', expectCatalog];
}

/** The resolver input, as the hook wrapper sends it (no previous_user_message: a run is one turn). */
export function resolveInput(message, session, shadow) {
  return { message, session_id: session, harness: 'qm', top_k: 5, exclude: [], shadow };
}

/** One resolver result from its stdout: the whole text as JSON, else the first line that parses as a JSON object. */
export function parseResolverStdout(stdout) {
  const text = String(stdout ?? '');
  for (const candidate of [text.trim(), ...text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))]) {
    if (!candidate) continue;
    try { const j = JSON.parse(candidate); if (isObj(j)) return j; } catch { /* try the next line */ }
  }
  return null;
}

/** The status line of one call. failure is the code when the wrapper absorbed the call (WRAPPER_TIMEOUT, SPAWN_FAILED,
 *  EXIT_<n>, BAD_JSON, RECEIPT_UNREADABLE, NO_RESULT); a result without schema_version 1 is BAD_SCHEMA. Codes otherwise
 *  follow the hook wrapper: the result's error code, NO_SKILL, BUDGET_EXHAUSTED, EMPTY or OK. */
export function statusLine({ result, receipt, call, turn, sessionKey = null, trial, arm = null, argv = [], exit = 0, failure = null, error = null, wallMs = 0, push = false, before = FRESH_SESSION, at = new Date().toISOString(), extra = {} }) {
  let fields = isObj(result) ? normalizeResult(result, before) : null;
  let code = failure;
  let why = error;
  if (!code && fields && fields.schema_version !== 1) { code = 'BAD_SCHEMA'; why = 'schema_version ' + JSON.stringify(fields.schema_version ?? null); fields = null; }
  const block = fields?.block ?? '';
  if (!code) {
    if (!fields) code = 'BAD_JSON';
    else if (fields.error) { code = fields.error_code; why = String(fields.error_message ?? '').slice(0, 300); }
    else if (fields.no_skill) code = 'NO_SKILL';
    else if (fields.budget_exhausted) code = 'BUDGET_EXHAUSTED';
    else if (!block) code = 'EMPTY';
    else code = 'OK';
  }
  const infraReasons = [];
  if (!isObj(receipt)) infraReasons.push('RECEIPT_UNREADABLE');
  if (code === 'CATALOG_MISMATCH') infraReasons.push('CATALOG_MISMATCH');
  if (fields?.index_stale === true) infraReasons.push('INDEX_STALE');
  if (isObj(receipt) && fields) {
    if (fields.index_hash !== receipt.index_hash) infraReasons.push('INDEX_HASH_DIFFERS');
    if (fields.gbrain_version !== receipt.gbrain_version) infraReasons.push('GBRAIN_VERSION_DIFFERS');
  }
  return {
    name: 'run', turn, session_key: sessionKey, harness: 'qm', arm, mode: call, code, exit,
    timing_ms: fields?.timing_ms ?? null, wall_ms: wallMs, index_stale: fields?.index_stale ?? null, index_hash: fields?.index_hash ?? null,
    gbrain_version: fields?.gbrain_version ?? null, catalog_hash: fields?.catalog_hash ?? null, block_sha256: block ? sha256(block) : null,
    block_bytes: Buffer.byteLength(block, 'utf8'), block_tokens: fields?.block_tokens ?? null, suggestions: fields?.suggestions ?? [], deduped: fields?.deduped ?? [],
    no_skill: fields?.no_skill ?? null, no_skill_reason: fields?.no_skill_reason ?? null, budget_exhausted: fields?.budget_exhausted ?? null,
    session_block_tokens: fields?.session_block_tokens ?? null, k: fields?.k ?? null, block_reason: fields?.block_reason ?? null, budget_phase: fields?.budget_phase ?? null,
    injected: push && code === 'OK', repeat: false, infra: infraReasons.length > 0, infra_reasons: infraReasons, argv, autorebuild_off: true, error: why,
    trial, call, label: ARM_LABELS[call] ?? call, at, ...extra,
  };
}

/** The emulated hook: the block, then one blank line, then the turn text. */
export function pushText(block, text) {
  return block + '\n\n' + text;
}

export function readReceipt(path) {
  try { const j = JSON.parse(readFileSync(path, 'utf8')); return isObj(j) ? normalizeReceipt(j) : null; } catch { return null; }
}

/** The session's state so far, from the status lines of that session and call: the last session_block_tokens, and whether any
 *  line's budget_phase was exhausted. */
export function sessionSoFar(logDir, sessionKey, call) {
  let lines = [];
  try { lines = readFileSync(join(logDir, STATUS_DIR, 'status.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return FRESH_SESSION; }
  const mine = lines.filter((l) => l.session_key === sessionKey && l.call === call && typeof l.session_block_tokens === 'number');
  return mine.length ? { spent: mine[mine.length - 1].session_block_tokens, exhausted: mine.some((l) => l.budget_phase === 'exhausted') } : FRESH_SESSION;
}

/** Runs the resolver once and absorbs every failure: { result, exit, failure, error, wallMs }. */
export function runResolver({ argv, input, gbrainHome, timeoutMs, path, shadowLog = '' }) {
  const started = Date.now();
  const r = spawnSync(argv[0], argv.slice(1), { input: JSON.stringify(input), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 << 20,
    env: { PATH: path || '/usr/local/bin:/usr/bin:/bin', HOME: dirname(gbrainHome), GBRAIN_HOME: gbrainHome, GBRAIN_SKILLS_NO_AUTOREBUILD: '1' } });
  const wallMs = Date.now() - started;
  if (r.error && r.error.code === 'ETIMEDOUT') return { result: null, exit: null, failure: 'WRAPPER_TIMEOUT', error: 'killed after ' + timeoutMs + ' ms', wallMs };
  if (r.error && r.error.code !== 'EPIPE') return { result: null, exit: null, failure: 'SPAWN_FAILED', error: String(r.error.message).slice(0, 300), wallMs };
  if (r.status !== 0) return { result: null, exit: r.status, failure: 'EXIT_' + (r.status ?? 'SIGNAL'), error: String(r.stderr ?? '').trim().slice(0, 300), wallMs };
  const stdout = parseResolverStdout(r.stdout);
  let logged = null;
  if (stdout && shadowLog) { try { logged = parseResolverStdout(readFileSync(shadowLog, 'utf8').trim().split('\n').pop()); } catch { /* no shadow log line: read stdout */ } }
  const result = logged ?? stdout;
  return result ? { result, exit: 0, failure: null, error: null, wallMs } : { result: null, exit: 0, failure: 'BAD_JSON', error: String(r.stdout ?? '').slice(0, 200), wallMs };
}

/** Appends status lines (and results) and merges any INFRA reasons into the trial's marker. */
export function record(logDir, entries) {
  const dir = join(logDir, STATUS_DIR);
  mkdirSync(dir, { recursive: true });
  for (const { line, result, input } of entries) {
    appendFileSync(join(dir, 'status.ndjson'), JSON.stringify(line) + '\n');
    if (result) appendFileSync(join(dir, 'results.ndjson'), JSON.stringify({ name: line.name, turn: line.turn, session_key: line.session_key, call: line.call, result, fields: normalizeResult(result), ...(input ? { input } : {}) }) + '\n');
  }
  const flagged = entries.map((e) => e.line).filter((l) => l.infra);
  if (!flagged.length) return;
  const path = join(dir, 'infra.json');
  let marker = null;
  try { marker = JSON.parse(readFileSync(path, 'utf8')); } catch { /* first mark */ }
  const reasons = [...new Set([...(marker?.reasons ?? []), ...flagged.flatMap((l) => l.infra_reasons)])].sort();
  const turns = [...(marker?.turns ?? []), ...flagged.map((l) => ({ turn: l.turn, call: l.call, code: l.code, infra_reasons: l.infra_reasons }))];
  writeFileSync(path, JSON.stringify({ schema: 'he-skill-resolver-infra/1', trial: flagged[0].trial, infra: true, reasons, turns, first_at: marker?.first_at ?? flagged[0].at }, null, 1) + '\n');
}

/** The number of status lines already written, so a call's turn counts on from them. */
function linesSoFar(logDir) {
  try { return readFileSync(join(logDir, STATUS_DIR, 'status.ndjson'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
}

/** Tool calls of a stored QM session, entries (payload.tool, payload.callId, payload.wire.argumentsJson) or items (kind
 *  ToolCall/ToolResult, tool, callId, text, body), each with its answer's text. */
export function sessionToolCalls(session) {
  const body = isObj(session?.body) ? session.body : session;
  const rows = Array.isArray(body?.entries)
    ? body.entries.map((e) => ({ seq: e.seq, kind: e.type === 'tool_call' ? 'call' : e.type === 'tool_result' ? 'result' : '', p: isObj(e.payload) ? e.payload : {}, text: null }))
    : Array.isArray(body?.items)
      ? body.items.map((i) => ({ seq: i.seq, kind: i.kind === 'ToolCall' ? 'call' : i.kind === 'ToolResult' ? 'result' : '', p: { ...(isObj(i.body) ? i.body : {}), tool: i.tool ?? i.body?.tool, callId: i.callId ?? i.body?.callId, ...(i.code !== undefined && i.code !== null ? { code: i.code } : {}) }, text: typeof i.text === 'string' ? i.text : null }))
      : [];
  const results = new Map();
  for (const r of rows) if (r.kind === 'result' && str(r.p.callId)) results.set(str(r.p.callId), r);
  return rows.filter((r) => r.kind === 'call').map((r) => {
    let args = {};
    try { const j = JSON.parse(str(r.p.wire?.argumentsJson)); if (isObj(j)) args = j; } catch { /* keep stored fields */ }
    const { wire: _w, step: _s, ...stored } = r.p;
    const res = results.get(str(r.p.callId));
    const resultText = res ? (res.text ?? (typeof res.p.result === 'string' ? res.p.result : typeof res.p.output === 'string' ? res.p.output : '')) : null;
    return { seq: r.seq, callId: str(r.p.callId) || null, tool: str(r.p.tool), args: { ...stored, ...args }, result: res ? res.p : null, resultText };
  });
}

/** QM's execute answer: the command's output with "[exit N]" appended on its own line; returns the output and N. */
export function splitExecuteResult(text) {
  const t = String(text ?? '');
  const m = /\n?\[exit (-?\d+)\]\n?$/.exec(t);
  return m ? { stdout: t.slice(0, m.index), exit: Number(m[1]) } : { stdout: t, exit: null };
}

/** The pull arm's status entries: every execute call whose command runs resolve-skills. */
export function pullEntries(session, { receipt, trial, arm = null, firstTurn = 1, at, before = FRESH_SESSION }) {
  const calls = sessionToolCalls(session).filter((c) => c.tool === 'execute' && /(^|[\s;&|(])resolve-skills\b/.test(str(c.args.command)));
  let state = before;
  return calls.map((c, i) => {
    const base = { receipt, call: 'pull', turn: firstTurn + i, arm, trial, before: state, ...(at ? { at } : {}) };
    if (c.resultText === null) return { line: statusLine({ ...base, result: null, exit: null, failure: 'NO_RESULT', extra: { seq: c.seq, call_id: c.callId } }), result: null };
    const { stdout, exit } = splitExecuteResult(c.resultText);
    const code = isObj(c.result) && typeof c.result.code === 'number' ? c.result.code : exit;
    const result = parseResolverStdout(stdout);
    const line = statusLine({ ...base, result, exit: code, failure: result ? null : 'BAD_JSON', extra: { seq: c.seq, call_id: c.callId, stdout_sha256: sha256(stdout) } });
    state = { spent: line.session_block_tokens ?? state.spent, exhausted: state.exhausted || line.budget_phase === 'exhausted' };
    return { line, result };
  });
}

/** One signed admin GET through qm-api.mjs (beside this file): { http, body }. */
function adminGet(env, path) {
  const r = spawnSync('node', [join(dirname(fileURLToPath(import.meta.url)), 'qm-api.mjs'), 'admin-get', env.QM_CORE_URL ?? '', env.QM_SIGNING_SECRET ?? '', env.QM_ADMIN_ACTOR || 'harness-admin@harness-eval', path], { encoding: 'utf8', timeout: 90_000, maxBuffer: 256 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch { return { http: 0, body: null, error: String(r.stderr ?? r.error?.message ?? '').slice(0, 300) }; }
}

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function main(argv) {
  const [mode, ...rest] = argv;
  const env = process.env;
  const trial = env.HE_TRIAL_ID ?? 'unknown';
  const arm = env.HE_HARNESS_CONFIG ?? null;
  const sourceHome = env.QM_SKILL_GBRAIN_HOME || DEFAULT_HOME;
  const receipt = readReceipt(env.QM_SKILL_RECEIPT || receiptPathIn(sourceHome, CATALOG));
  if (mode === 'turn') {
    const [call, textIn, textOut, logDir, sessionKey] = rest;
    if (!['shadow', 'push'].includes(call) || !textIn || !textOut || !logDir || !sessionKey) { console.error('usage: skill-resolver.mjs turn <shadow|push> <text-in> <text-out> <log-dir> <session-key>'); return 64; }
    const text = readFileSync(textIn, 'utf8');
    try {
      const gbrainHome = join(env.HOME || '/tmp', 'he-skills', 'gbrain-home');
      if (!existsSync(gbrainHome) && existsSync(sourceHome)) cpSync(sourceHome, gbrainHome, { recursive: true });
      const shadow = call === 'shadow';
      const base = { receipt, call, turn: linesSoFar(logDir) + 1, sessionKey, trial, arm, push: !shadow, before: sessionSoFar(logDir, sessionKey, call) };
      let entry;
      if (!receipt?.catalog_hash) entry = { line: statusLine({ ...base, result: null, exit: null, failure: 'RECEIPT_UNREADABLE', error: 'no readable build receipt' }), result: null };
      else {
        const shadowLog = shadow ? join(logDir, STATUS_DIR, 'shadow.ndjson') : '';
        if (shadowLog) { mkdirSync(dirname(shadowLog), { recursive: true }); rmSync(shadowLog, { force: true }); }
        const args = resolveArgv(env.QM_SKILL_RESOLVER_BIN || 'gbrain', sessionKey, String(receipt.catalog_hash), shadow, shadowLog);
        const input = resolveInput(text, sessionKey, shadow);
        const ran = runResolver({ argv: args, input, gbrainHome, timeoutMs: Number(env.QM_SKILL_RESOLVER_TIMEOUT_MS || 10000), path: env.PATH, shadowLog });
        entry = { line: statusLine({ ...base, result: ran.result, argv: args, exit: ran.exit, failure: ran.failure, error: ran.error, wallMs: ran.wallMs }), result: ran.result, input };
      }
      writeFileSync(textOut, entry.line.injected ? pushText(normalizeResult(entry.result).block, text) : text);
      record(logDir, [entry]);
      const l = entry.line;
      console.error('skill-resolver: turn ' + l.turn + ' ' + call + ' code=' + l.code + ' block_sha256=' + (l.block_sha256 ?? '-') + ' injected=' + l.injected + (l.infra ? ' INFRA ' + l.infra_reasons.join(',') : ''));
    } catch (e) {
      if (!existsSync(textOut)) copyFileSync(textIn, textOut);
      console.error('skill-resolver: internal error, turn text unchanged: ' + String(e?.message ?? e).slice(0, 500));
    }
    return 0;
  }
  if (mode === 'pull') {
    const [turnPath, logDir] = rest;
    if (!turnPath || !logDir) { console.error('usage: skill-resolver.mjs pull <qm-turn.json> <log-dir>'); return 64; }
    let sessionId = null;
    try { sessionId = JSON.parse(readFileSync(turnPath, 'utf8'))?.body?.sessionId ?? null; } catch { /* no turn answer */ }
    if (!sessionId) { console.error('skill-resolver: pull: the turn answer has no sessionId, so no status line can be read'); return 0; }
    mkdirSync(join(logDir, STATUS_DIR), { recursive: true });
    const session = adminGet(env, '/v1/admin/sessions/' + encodeURIComponent(sessionId) + '?scope=' + encodeURIComponent('personal:' + (env.QM_ACTOR_ID || 'U1')) + '&limit=50000');
    writeFileSync(join(logDir, STATUS_DIR, 'qm-session.json'), JSON.stringify(session) + '\n');
    if (session.http !== 200) { console.error('skill-resolver: pull: session read answered ' + session.http); return 0; }
    const entries = pullEntries(session, { receipt, trial, arm, firstTurn: linesSoFar(logDir) + 1, before: sessionSoFar(logDir, null, 'pull') });
    record(logDir, entries);
    console.error('skill-resolver: pull ' + entries.length + ' call(s)' + (entries.some((e) => e.line.infra) ? ' INFRA ' + [...new Set(entries.flatMap((e) => e.line.infra_reasons))].join(',') : ''));
    return 0;
  }
  if (mode === 'listing') {
    const [out] = rest;
    if (!out) { console.error('usage: skill-resolver.mjs listing <out.json>'); return 64; }
    const path = '/v1/admin/skills?scope=' + encodeURIComponent(env.QM_ORG_SCOPE || 'org:harness-eval') + '&limit=1000';
    const t0 = Date.now();
    let got = null, last = -1, stable = 0;
    while (Date.now() - t0 < 60_000) {
      got = adminGet(env, path);
      const items = got?.body?.items ?? got?.body?.skills ?? [];
      if (got.http === 200 && Array.isArray(items) && items.length === last) { if (++stable >= 2) break; } else stable = 0;
      last = Array.isArray(items) ? items.length : -1;
      sleepMs(2000);
    }
    const items = (got?.body?.items ?? got?.body?.skills ?? []).map((s) => ({ name: s.name, createdBy: s.createdBy, status: s.status }));
    const byCreator = {};
    for (const s of items) byCreator[s.createdBy] = (byCreator[s.createdBy] ?? 0) + 1;
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), http: got?.http ?? 0, settled_ms: Date.now() - t0, count: items.length, by_creator: byCreator, skills: items }, null, 1) + '\n');
    console.error('skill-resolver: listing ' + items.length + ' skill(s) ' + JSON.stringify(byCreator));
    return 0;
  }
  console.error('usage: skill-resolver.mjs turn <shadow|push> <text-in> <text-out> <log-dir> <session-key> | pull <qm-turn.json> <log-dir> | listing <out.json>');
  return 64;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
