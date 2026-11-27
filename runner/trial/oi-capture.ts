// internal-task family C (owner identity, session capture; docs/owner-identity.md "Family C"). A family C task (capture.json beside
// task.toml, world/owner-identity/capture.ts) has two owner-typed sessions and four headless workers that the harness's own session
// launches through /opt/harness/capture/launch-workers.sh. This file holds the runner's two parts of it:
//
// captureEnv  the cell check (Claude Code or Codex, gbrain.llm "proxy", gbrain.install "gbrain-installer", the default config; else
//             HE-TASK-006) and HE_OI_CAPTURE_B64, the plan the adapter's capture/wire-capture.cjs reads.
// checkCapture the pilot check, after the harness stops: did gbrain's SessionEnd hook bank each gold session in the harness's corpus
//             spool (<state>/.gbrain/transcripts/corpus/sourced/<sid>[.<stamp>].txt) with the decision source gbrain's speaker
//             sidecar (<sid>.speaker.json, gbrain src/core/context/session-speaker.ts) should carry? Owner-typed sessions and the
//             orchestrator session carry no sidecar (gbrain's owner default); an env worker carries {principal: its
//             GBRAIN_SESSION_AGENT label, source "env"}; a detected worker {principal "agent-launched", source "detected"}. A gold
//             session is found by its fact tokens, the orchestrator session as the one banked session with no gold token. Writes
//             <trial dir>/owner-identity/capture.json; it never fails the trial, it is the evidence a pilot reads.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CAPTURE_HARNESSES, type CapturePlan, type CaptureSession } from '../../world/owner-identity/capture.ts';
import { RunnerError } from '../errors.ts';

/** gbrain's principal for a detected worker (src/core/context/session-speaker.ts DETECTED_PRINCIPAL). */
export const DETECTED_PRINCIPAL = 'agent-launched';

export interface Speaker { principal: string; source: string }

export interface CaptureSessionCheck {
  n: number; kind: CaptureSession['kind']; launch: CaptureSession['launch']; tokens: number;
  expected: Speaker | null;
  /** The corpus session ids whose text carries this session's tokens (the orchestrator: the banked sessions with no gold token). */
  sessions: string[]; files: string[];
  observed: Speaker | null;
  pass: boolean; reason: string | null;
}
export interface CaptureCheck {
  task: string; corpus_dir: string; corpus_files: number; corpus_sessions: number;
  sessions: CaptureSessionCheck[];
  /** Corpus sessions that carry tokens of more than one gold session (a worker's brief in the orchestrator's transcript, say). */
  mixed: Array<{ session: string; gold_sessions: number[] }>;
  heartbeat: { file: string; session_end: Record<string, number> } | null;
  launch: { file: string; ancestors: string[]; harness_ancestor: boolean; workers: Array<{ worker: number; launch: string; exit: number | null; seconds: number | null }> } | null;
  pass: boolean;
}

export const capturePlanPath = (taskDir: string) => join(taskDir, 'capture.json');
export const readCapturePlan = (taskDir: string): CapturePlan | null => existsSync(capturePlanPath(taskDir)) ? JSON.parse(readFileSync(capturePlanPath(taskDir), 'utf8')) as CapturePlan : null;
export const corpusDirOf = (stateDir: string) => join(stateDir, '.gbrain', 'transcripts', 'corpus');

/** The adapter env for a family C task, or {} for any other task; a cell that cannot run one is HE-TASK-006. */
export function captureEnv(taskDir: string, cell: { id: string; harness: string; config?: string; gbrain?: { llm?: unknown; install?: string } }): Record<string, string> {
  const file = capturePlanPath(taskDir);
  if (!existsSync(file)) return {};
  const why = [
    (CAPTURE_HARNESSES as readonly string[]).includes(cell.harness) ? '' : `harness ${cell.harness} has no capture wiring (claude-code and codex only)`,
    cell.gbrain?.llm === 'proxy' ? '' : 'gbrain.llm is not "proxy", so nothing would extract the banked sessions',
    cell.gbrain?.install === 'gbrain-installer' ? '' : 'gbrain.install is not "gbrain-installer", so the harness has no gbrain binary or hook launcher for the SessionEnd hook',
    !cell.config || cell.config === 'default' ? '' : `config ${cell.config} is not the default`,
  ].filter(Boolean);
  if (why.length) throw new RunnerError('HE-TASK-006', `cell ${cell.id} cannot run the family C task at ${taskDir}: ${why.join('; ')}; fix: run family C on a claude-code or codex cell with gbrain {"llm": "proxy", "install": "gbrain-installer"} and no config (docs/owner-identity.md, "Family C")`);
  return { HE_OI_CAPTURE_B64: readFileSync(file).toString('base64') };
}

const readJson = (f: string): unknown => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const speakerAt = (f: string): Speaker | null => {
  const s = readJson(f) as { principal?: unknown; source?: unknown } | null;
  return s && typeof s.principal === 'string' && typeof s.source === 'string' ? { principal: s.principal, source: s.source } : null;
};
const same = (a: Speaker | null, b: Speaker | null) => a === b || (!!a && !!b && a.principal === b.principal && a.source === b.source);
const show = (s: Speaker | null) => (s ? `${s.principal}/${s.source}` : 'no sidecar (owner)');

/** The banked corpus files by session id: the spool (sourced/) and the corpus root, *.txt only. */
export function corpusSessions(corpusDir: string): Map<string, { files: string[]; text: string; speaker: Speaker | null }> {
  const out = new Map<string, { files: string[]; text: string; speaker: Speaker | null }>();
  for (const dir of [join(corpusDir, 'sourced'), corpusDir]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.txt')) continue;
      const sid = name.split('.')[0]!;
      const e = out.get(sid) ?? { files: [], text: '', speaker: null };
      e.files.push(join(dir, name));
      e.text += readFileSync(join(dir, name), 'utf8') + '\n';
      e.speaker ??= speakerAt(join(dir, `${sid}.speaker.json`));
      out.set(sid, e);
    }
  }
  return out;
}

/** The pilot check of one family C trial (see the file header). */
export function checkCapture(o: { taskDir: string; stateDir: string; logsDir: string; out?: string }): CaptureCheck {
  const plan = readCapturePlan(o.taskDir);
  if (!plan) throw new RunnerError('HE-TASK-006', `no capture.json in ${o.taskDir}; checkCapture reads family C tasks only`);
  const gold = JSON.parse(readFileSync(join(o.taskDir, 'gold.json'), 'utf8')) as { facts: Array<{ token: string; where: { session?: number } }> };
  const corpus_dir = corpusDirOf(o.stateDir);
  const banked = corpusSessions(corpus_dir);
  const tokensOf = (n: number) => gold.facts.filter((f) => f.where.session === n).map((f) => f.token);
  const goldOf = (text: string) => plan.sessions.filter((s) => tokensOf(s.n).some((t) => text.includes(t))).map((s) => s.n);
  const untokened = [...banked.entries()].filter(([, e]) => !goldOf(e.text).length).map(([sid]) => sid);
  const sessions = plan.sessions.map((s): CaptureSessionCheck => {
    const tokens = tokensOf(s.n);
    const expected: Speaker | null = s.kind !== 'worker' ? null : s.launch === 'env' ? { principal: s.agent ?? '', source: 'env' } : { principal: DETECTED_PRINCIPAL, source: 'detected' };
    const sids = s.kind === 'orchestrator' ? untokened : [...banked.entries()].filter(([, e]) => tokens.some((t) => e.text.includes(t))).map(([sid]) => sid);
    const entries = sids.map((sid) => banked.get(sid)!);
    const observed = entries[0]?.speaker ?? null;
    const reason = !sids.length ? 'not banked: no corpus session carries this session\'s text'
      : sids.length > 1 ? `${sids.length} corpus sessions match (${sids.join(', ')}), expected one`
      : !same(observed, expected) ? `decision source ${show(observed)}, expected ${show(expected)}` : null;
    return { n: s.n, kind: s.kind, launch: s.launch, tokens: tokens.length, expected, sessions: sids, files: entries.flatMap((e) => e.files), observed, pass: reason === null, reason };
  });
  const mixed = [...banked.entries()].map(([sid, e]) => ({ session: sid, gold_sessions: goldOf(e.text) })).filter((m) => m.gold_sessions.length > 1);
  const hbFile = join(o.stateDir, '.gbrain', 'integrations', 'hooks', 'heartbeat.jsonl');
  const heartbeat = existsSync(hbFile) ? { file: hbFile, session_end: readFileSync(hbFile, 'utf8').split('\n').filter(Boolean).map((l) => parseLine(l)).filter((h) => h?.event === 'session-end').reduce<Record<string, number>>((acc, h) => { const k = `${h!.outcome}${h!.reason ? ':' + h!.reason : ''}`; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}) } : null;
  const launchFile = join(o.logsDir, 'launch.jsonl');
  let launch: CaptureCheck['launch'] = null;
  if (existsSync(launchFile)) {
    const rows = readFileSync(launchFile, 'utf8').split('\n').filter(Boolean).map((l) => parseLine(l) ?? {});
    const ancestors = ((rows[0]?.ancestors ?? []) as string[]).map(String);
    launch = { file: launchFile, ancestors, harness_ancestor: ancestors.some((a) => /:(claude|codex)$/.test(a)), workers: (rows.slice(1).some((r) => r.started === true) ? rows.slice(1).filter((r) => r.started === true) : rows.slice(1)).map((r) => {
      const end = rows.slice(1).find((e) => e.started !== true && Number(e.worker) === Number(r.worker)); // a launcher before started rows wrote exit rows only
      return { worker: Number(r.worker), launch: String(r.launch), exit: end ? Number(end.exit) : null, seconds: end ? Number(end.seconds) : null };
    }) };
  }
  const check: CaptureCheck = { task: plan.task, corpus_dir, corpus_files: [...banked.values()].reduce((a, e) => a + e.files.length, 0), corpus_sessions: banked.size, sessions, mixed, heartbeat, launch, pass: sessions.every((s) => s.pass) && !mixed.length };
  if (o.out) { mkdirSync(dirname(o.out), { recursive: true }); writeFileSync(o.out, JSON.stringify(check, null, 1) + '\n'); }
  return check;
}

function parseLine(line: string): Record<string, any> | null { try { return JSON.parse(line) as Record<string, any>; } catch { return null; } }

/** One line per gold session for a log or the CLI. */
export const captureLines = (c: CaptureCheck): string[] => [
  ...c.sessions.map((s) => `${s.pass ? 'PASS' : 'FAIL'} session ${s.n} ${s.kind}${s.kind === 'worker' ? ` (${s.launch})` : ''}: ${s.pass ? `banked as ${show(s.observed)}` : s.reason}`),
  ...c.mixed.map((m) => `FAIL corpus session ${m.session} carries tokens of gold sessions ${m.gold_sessions.join(', ')}`),
];
