// Phase B trials (internal-task): one request row through one harness, single-shot, with the request as the member's one turn in a
// fresh session (docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md, "Got the skill").
//
// A skill-requests cell names a set file (requests: <path>, JSON lines {id, request} for set P or {id, text, prev_user_text}
// for set R, each with an optional half) and request_set, the set's name. Every row (or the rows of half dev or test) is a task
// whose id is the row id. The trial is an ordinary multi-user trial on the serve entry (runner/trial/trial.ts runTrial), the
// entry the skill arms run on (scripts/skill-resolver/ARMS.md): a freshly started harness in the v0.1 world, and one task
// this module writes to a temporary directory, in which PHASE_B_ACTOR sends the request verbatim as a DM. The cell's config
// reaches the adapter as HE_HARNESS_CONFIG and its skill_arm as HE_SKILL_ARM. The member's text is the row's request, or for a
// row with prev_user_text (set R) the composite the judges saw (composeRequest), so the resolver ranks that too. QM is the exception: its skill arms are wired on
// its run entry only and its serve entry cannot register the world at this pin, so a QM trial runs the request as the one turn of
// adapter.sh run (harnesses/run-trial.sh, writeRunRequestTask), as set T does, with no world and no preamble. A private cell's
// record carries no hash of any request; the manifest's request_sets holds the set file's sha256.
//
// The proxy slot is bound with collect_requests, so the forwarded request bodies stay in the proxy's memory and reach the
// runner once after the trial, and with max_requests when the cell sets request_cap (6 in the preregistration): the harness's
// next request for the cell's model after that many is refused (HTTP 400, reason request_cap) and the trial is request_cap.
// Got the skill comes from those bodies (and, on Claude Code and Codex, the harness's own trace) through
// scripts/skill-resolver/got-skill.ts, or harnesses/qm/skill-opens.ts on QM, and is written to <trial dir>/got-skill.json.
//
// Before the scrub the runner also counts the trial's tool calls that name a gstack path outside its own catalog copy
// (gstackReads), the clean-arm audit for these trials, because the scrub removes the traces scripts/v04/clean-arm-audit.ts reads.
//
// Request text never stays in the trial directory: after got-skill.json is written, everything but KEEP is removed (the
// world's event log and snapshot, the turn files, harness state and transcripts), and every kept file and the run-trial log is passed
// through redactRequest, which withholds any line holding the request (exact or JSON-escaped, 8+ characters) or sharing an
// 8-word shingle with it.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { RunnerError } from '../errors.ts';
import { gotSkill, strings, toolCalls, type Harness } from '../../scripts/skill-resolver/got-skill.ts';
import { normalizeResult } from '../../scripts/skill-resolver/result-fields.ts';
import { skillOpens } from '../../harnesses/qm/skill-opens.ts';

export const SKILL_REQUESTS_SLICE = 'skill-requests';
/** Wall clock per Phase B trial (HE_TIME_BUDGET_S); run-trial.sh adds its own kill grace. */
export const SKILL_REQUESTS_TIME_BUDGET_S = 600;
export const REQUEST_HALVES = ['dev', 'test', 'all'] as const;
/** The member who sends every Phase B request: a member of the v0.1 seed world, so the turn is an ordinary member DM. */
export const PHASE_B_ACTOR = 'dana-okafor';

/** What stays in a Phase B trial directory: the runner's own files and the resolver's status lines (analyze.ts reads them). */
export const KEEP = ['usage.json', 'reconcile.json', 'got-skill.json', 'result.json', 'logs/ready', 'logs/adapter.log',
  'logs/skill-resolver/status.ndjson', 'logs/skill-resolver.ndjson', 'logs/skill-resolver.infra.json'];

/** The harness's own trace got-skill.ts reads, per harness: the event log of every turn under the trial directory, written by the
 *  serve entry as logs/turns/<turn>.<ext>.jsonl (harnesses/claude-code/adapter.sh run_turn, harnesses/codex/adapter.sh codex_turn)
 *  and by the run entry as logs/run.<ext>.jsonl. Paths relative to the trial directory, in turn order. */
const TRACE_EXT: Record<string, string> = { 'claude-code': 'claude', codex: 'codex' };
export function traceFiles(harness: string, trialDir: string): string[] {
  const ext = TRACE_EXT[harness];
  if (!ext) return [];
  const turns = join(trialDir, 'logs', 'turns');
  const perTurn = existsSync(turns) ? readdirSync(turns).filter((f) => f.endsWith('.' + ext + '.jsonl')).sort().map((f) => 'logs/turns/' + f) : [];
  return [...(existsSync(join(trialDir, 'logs', 'run.' + ext + '.jsonl')) ? ['logs/run.' + ext + '.jsonl'] : []), ...perTurn];
}
const readTraces = (harness: string, trialDir: string) => traceFiles(harness, trialDir).map((f) => readFileSync(join(trialDir, f), 'utf8').split('\n'));

/** text: the row's request (or text); sent: what the member sends, text alone or, when the row has prev_user_text (set R), the
 *  composite the judges saw (composeRequest). */
export type RequestRow = { id: string; text: string; prev_user_text: string | null; half: string | null; sent: string };

/** The member's message for a row, built exactly as scripts/skill-resolver/label-set.ts builds the judge's request, so the agent
 *  and the resolver see the context the label was given. */
export const composeRequest = (text: string, prev: string | null): string => (prev ? 'Previous message from the same user: ' + prev + '\n\nCurrent message: ' : '') + text;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The rows of a set file. Errors name line numbers only, never a row's text. */
export function readRequestSet(path: string): RequestRow[] {
  if (!existsSync(path)) throw new RunnerError('HE-PREREG-004', `request set ${path} does not exist`);
  const rows: RequestRow[] = [];
  const seen = new Set<string>();
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let r: Record<string, unknown>;
    try { r = JSON.parse(line); } catch { throw new RunnerError('HE-PREREG-004', `request set ${path} line ${i + 1} is not JSON`); }
    const text = typeof r.request === 'string' ? r.request : typeof r.text === 'string' ? r.text : null;
    if (typeof r.id !== 'string' || !ID.test(r.id)) throw new RunnerError('HE-PREREG-004', `request set ${path} line ${i + 1}: id must match ${ID.source}`);
    if (!text) throw new RunnerError('HE-PREREG-004', `request set ${path} line ${i + 1} (id ${r.id}): no request or text field`);
    if (seen.has(r.id)) throw new RunnerError('HE-PREREG-004', `request set ${path}: id ${r.id} appears twice`);
    seen.add(r.id);
    const prev = typeof r.prev_user_text === 'string' && r.prev_user_text ? r.prev_user_text : null;
    rows.push({ id: r.id, text, prev_user_text: prev, half: typeof r.half === 'string' ? r.half : null, sent: composeRequest(text, prev) });
  });
  return rows;
}

export function requestSetIds(path: string, half: string = 'all'): string[] {
  return readRequestSet(path).filter((r) => half === 'all' || r.half === half).map((r) => r.id);
}

/** Why a private cell's set path is refused (it resolves inside the repository), or null. */
export function privateSetProblem(cell: { id: string; requests?: string; private?: boolean }, repoRoot: string): string | null {
  if (cell.private !== true || !cell.requests) return null;
  return insideDir(cell.requests, repoRoot) ? `cell ${cell.id} is private and its request set ${cell.requests} is inside the repository (${repoRoot}); fix: keep a private set outside the repository and name its absolute path` : null;
}

/** Whether path (after symbolic links, as far as it exists) is root or inside it. */
export function insideDir(path: string, root: string): boolean {
  const real = (p: string): string => { try { return realpathSync(p); } catch { const up = dirname(p); return up === p ? p : join(real(up), p.slice(up.length + (up.endsWith(sep) ? 0 : 1))); } };
  const r = real(resolve(root)), p = real(resolve(path));
  return p === r || p.startsWith(r + sep);
}

/** The one-turn task the serve entry runs (runner/trial/task.ts loadTask): PHASE_B_ACTOR sends the request, verbatim, as a DM;
 *  no predicates. It lives in a temporary directory for the trial only. Returns its path. */
export function writeRequestTask(row: RequestRow, outDir: string, timeBudgetS = SKILL_REQUESTS_TIME_BUDGET_S): string {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'task.toml'), [`id = "${row.id}"`, `slice = "${SKILL_REQUESTS_SLICE}"`, 'split = "dev"', `time_budget_s = ${timeBudgetS}`, `actors = ["${PHASE_B_ACTOR}"]`, '',
    '[[turns]]', `actor = "${PHASE_B_ACTOR}"`, 'channel = "dm"', `text = ${JSON.stringify(row.sent)}`, '', '[predicates]', 'required = []', 'forbidden_effects = []', ''].join('\n'));
  return outDir;
}

/** QM's Phase B task, for harnesses/run-trial.sh (QM wires its skill arms on the run entry only): instruction.md holds the
 *  request verbatim, task.toml the slice and time budget, and the grader only says the runner scores the trial. */
export function writeRunRequestTask(row: RequestRow, outDir: string, timeBudgetS = SKILL_REQUESTS_TIME_BUDGET_S): string {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'grader'), { recursive: true });
  writeFileSync(join(outDir, 'instruction.md'), row.sent);
  writeFileSync(join(outDir, 'task.toml'), `id = "${row.id}"\nslice = "${SKILL_REQUESTS_SLICE}"\ntime_budget_s = ${timeBudgetS}\n`);
  writeFileSync(join(outDir, 'grader', 'check.sh'), '#!/usr/bin/env bash\n# Phase B: runner/trial/skill-requests.ts writes got-skill.json after the run.\necho "scored by runner/trial/skill-requests.ts"\nexit 0\n', { mode: 0o755 });
  return outDir;
}

/** got-skill.json for a trial: got-skill.ts on the four push harnesses (catalog_opened), skill-opens.ts on QM (opened). refused:
 *  the body the request cap refused, whose history holds the tool calls of the agent's last step; read with the rest. */
export function gotSkillRecord(harness: string, catalog: string[], requests: unknown[], trialDir: string, refused: unknown[] = []): { file: Record<string, unknown>; opened: string[] } {
  const source = ['proxy-requests', ...(refused.length ? ['proxy-refused-request'] : []), ...traceFiles(harness, trialDir)];
  const bodies = [...requests, ...refused];
  if (harness === 'qm') {
    const o = skillOpens({ catalog, requests: bodies as Array<Record<string, unknown>> });
    return { file: { schema: 'he-got-skill/1', harness, source, requests: requests.length, opened: o.opened, opens: o.opens, other: o.other, refused: o.refused }, opened: o.opened };
  }
  if (!['openclaw', 'claude-code', 'codex', 'hermes'].includes(harness)) throw new RunnerError('HE-RUN-002', `skill-requests: no got-skill reader for harness ${harness}`);
  const g = gotSkill({ harness: harness as Harness, catalog, requests: bodies, traces: readTraces(harness, trialDir) });
  return { file: { schema: 'he-got-skill/1', source, requests: requests.length, ...g }, opened: g.catalog_opened };
}

/** gstack at the start of a word (gstack, gstack-ship, .gstack, open-gstack-browser), never inside one (sigstack), as
 *  scripts/v04/clean-arm-audit.ts matches it. */
const GSTACK = /(?<![a-z])gstack/i;
/** The trial's own catalog copy, as a path the agent names inside the container: the skill kit, OpenClaw's /workspace/skills,
 *  the Claude Code, Codex and Hermes skills roots under /harness-state/<harness>/skills (also written through their variables),
 *  and the skill trees QM syncs into its sandbox under .agent-skills/. */
const CATALOG_COPY = [/^\/opt\/skill-resolver\//, /^\$\{?HE_SKILL_KIT_DIR\}?\//, /^\/workspace\/skills\//, /^\/(?:root\/)?workspace\/\.agent-skills\//,
  /^(?:\/harness-state|\$\{?HE_SESSION_STATE_DIR\}?)\/[^/]+\/skills\//, /^\$\{?(?:CODEX_HOME|HERMES_HOME|CLAUDE_CONFIG_DIR)\}?\/skills\//];

/** The clean-arm count (CREW.md, "Clean no-gstack and no-brain arms"), taken before the scrub removes the traces: the trial's
 *  tool calls (from the request bodies the proxy held and, on Claude Code and Codex, the harness's own trace) that name a path
 *  with a gstack segment outside the trial's own catalog copy, such as the Capy drive's gstack skill, ~/.local/share/gstack or a
 *  gstack checkout. A call counts once however many such paths it names, and whether or not the read succeeded: the attempt is
 *  what shows the agent could see gstack. A relative path is taken from /workspace, the harnesses' working directory, and a
 *  process-mode path under the trial directory as the container path it stands for (workspace/ as /workspace, state/ as
 *  /harness-state). requests includes the body the request cap refused, so a final tool call is seen on every harness. */
export function gstackReads(harness: string, requests: unknown[], trialDir: string): { gstack_reads: number; paths: string[]; contaminated: boolean } {
  const traces = readTraces(harness, trialDir);
  const root = resolve(trialDir) + '/';
  const inContainer = (p: string) => !p.startsWith(root) ? p : p.slice(root.length).replace(/^workspace\//, '/workspace/').replace(/^state\//, '/harness-state/');
  const paths = new Set<string>();
  let reads = 0;
  for (const c of toolCalls(requests, traces)) {
    const hits = strings(c.input).flatMap((s) => s.split(/[\s"'`<>()|;&,=]+/)).map((t) => t.replace(/[.,:;]+$/, ''))
      .filter((t) => t.includes('/') && GSTACK.test(t))
      .filter((t) => { const p = inContainer(t); const abs = /^[/~$]|^[a-z]+:\/\//i.test(p) ? p : posix.resolve('/workspace', p); return !CATALOG_COPY.some((re) => re.test(abs)); });
    if (!hits.length) continue;
    reads++;
    hits.forEach((h) => paths.add(h));
  }
  return { gstack_reads: reads, paths: [...paths].sort(), contaminated: reads > 0 };
}

/** The preregistration's delivery rule (PREREGISTRATION.md, Resolver contract, INFRA): a pushed block must be byte for byte in a
 *  captured model request, and a shadow block must be in none. Reads the hook wrapper's status and results lines under the trial
 *  directory (before the scrub removes results.ndjson) and the slot's collected request bodies. When a rule fails it writes
 *  logs/skill-resolver.infra.json, the marker analyze.ts counts as INFRA, with BLOCK_NOT_IN_REQUEST or SHADOW_BLOCK_IN_REQUEST.
 *  Returns null when the trial logged no resolver turn (QM, which keeps its own status lines, or an arm without the hook). */
export function checkBlockDelivery(trialDir: string, requests: unknown[]): { pushed: number; carried: number; shadow: number; leaked: number; reasons: string[] } | null {
  const nd = (p: string) => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
  const dir = join(trialDir, 'logs', 'skill-resolver');
  const status = nd(join(dir, 'status.ndjson')).filter((s) => !s.repeat);
  if (!status.length) return null;
  const mode = new Map(status.map((s) => [String(s.name), s.mode]));
  const bodies = requests.map((b) => strings(b));
  const carried = (block: string) => bodies.some((ss) => ss.some((s) => s.includes(block)));
  const out = { pushed: 0, carried: 0, shadow: 0, leaked: 0, reasons: [] as string[] };
  for (const r of nd(join(dir, 'results.ndjson'))) {
    const block = normalizeResult(r.result).block;
    if (!block) continue;
    if (mode.get(String(r.name)) === 'push') { out.pushed++; if (carried(block)) out.carried++; }
    else { out.shadow++; if (carried(block)) out.leaked++; }
  }
  if (out.carried < out.pushed) out.reasons.push('BLOCK_NOT_IN_REQUEST');
  if (out.leaked) out.reasons.push('SHADOW_BLOCK_IN_REQUEST');
  if (out.reasons.length) writeFileSync(join(trialDir, 'logs', 'skill-resolver.infra.json'), JSON.stringify({ reasons: out.reasons }) + '\n');
  return out;
}

const words = (s: string) => s.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const shingles = (s: string, k = 8) => { const w = words(s); const out = new Set<string>(); for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(' ')); return out; };

/** Withholds every line of body that holds one of texts (exact or JSON-escaped, 8+ characters) or shares an 8-word shingle
 *  with one. Returns the new body and how many lines were withheld. */
export function redactRequest(body: string, texts: string[]): { body: string; lines: number } {
  const needles = texts.flatMap((t) => [t, JSON.stringify(t).slice(1, -1), ...t.split('\n')]).map((s) => s.trim()).filter((s) => s.length >= 8);
  const grams = new Set(texts.flatMap((t) => [...shingles(t)]));
  let n = 0;
  const out = body.split('\n').map((line) => {
    const hit = needles.some((s) => line.includes(s)) || (grams.size > 0 && [...shingles(line)].some((g) => grams.has(g)));
    if (!hit) return line;
    n++;
    return '[line withheld by runner/trial/skill-requests.ts: request text]';
  });
  return { body: out.join('\n'), lines: n };
}

/** Removes everything in the trial directory but KEEP and redacts what stays. */
export function scrubTrialDir(trialDir: string, texts: string[]): { kept: string[]; removed: number; redacted_lines: number } {
  const walk = (d: string): string[] => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() && !e.isSymbolicLink() ? walk(join(d, e.name)) : [join(d, e.name)]) : [];
  let removed = 0, redacted = 0;
  const kept: string[] = [], stuck: string[] = [];
  for (const f of walk(trialDir)) {
    const rel = relative(trialDir, f).split(sep).join('/');
    if (!KEEP.includes(rel)) { try { rmSync(f, { force: true }); } catch { stuck.push(rel); } removed++; continue; }
    const r = redactRequest(readFileSync(f, 'utf8'), texts);
    if (r.lines) writeFileSync(f, r.body);
    redacted += r.lines;
    kept.push(rel);
  }
  // A file a container wrote as another user (QM's stack) is removed through a throwaway container that mounts the trial directory.
  if (stuck.length) {
    const r = spawnSync('docker', ['run', '--rm', '-v', resolve(trialDir) + ':/t', 'busybox:1.37', 'rm', '-rf', ...stuck.map((s) => '/t/' + s)], { encoding: 'utf8' });
    if (r.status !== 0) throw new RunnerError('HE-RUN-006', `could not remove ${stuck.length} file(s) holding harness state from ${trialDir}; fix: remove them by hand before sharing the directory`);
  }
  const prune = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { prune(join(d, e.name)); if (!readdirSync(join(d, e.name)).length) try { rmSync(join(d, e.name), { recursive: true }); } catch { /* an empty directory another user owns */ } } };
  if (existsSync(trialDir) && statSync(trialDir).isDirectory()) prune(trialDir);
  return { kept: kept.sort(), removed, redacted_lines: redacted };
}
