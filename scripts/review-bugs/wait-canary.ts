#!/usr/bin/env bun
/**
 * Keyless background-wait canary (plan internal-task, "Exposure gate": before any paid trial, a scripted model dispatches a
 * background reader that returns after 120 seconds and the canary checks the session waits; the internal-task failure is a
 * session that ends while a reader is still out). One run per harness image:
 *
 *   bun scripts/review-bugs/wait-canary.ts --harness openclaw|hermes|codex [--scenario <s>] [--image <tag>]
 *       [--hermes-mode oneshot|chat] [--delay <s>] [--budget <s>] [--out <dir>]
 *
 * What runs: scripts/review-bugs/fake-reader-model.ts on the docker bridge address plays the model by rules; the REAL
 * metering proxy (runner/proxy/metering-proxy.ts) runs in lease mode in a child process with a scratch ledger and only
 * PATH, HOME and dummy provider keys in its environment, its upstream pointed at the fake, and one slot bound to a
 * per-run token (the scratch lease is $25 because the proxy reserves about $2.76 for each 128000-token Opus request
 * and the main session and a reader can be in flight together; the fake reports 1 token in and out, so almost nothing is
 * charged against it, and no request leaves the machine); the harness image runs one turn the way scripts/gsta-135/preflight.sh's probe does, seeing only the
 * proxy URL and the dummy token. The main session dispatches one reader through the harness's own subagent tool
 * (OpenClaw sessions_spawn through its tool_call bridge, Hermes delegate_task, Codex spawn_agent); the reader's model call
 * answers only after --delay seconds (default 120); then the main session, if it is asked again, writes its final answer.
 * The verdict is read from the harness's own transcript with scripts/review-bugs/exposure.ts, never from a wrapper log.
 *
 * Scenarios (what the scripted main session does after the dispatch):
 *   wait      what the harness's own tool text tells it to do: OpenClaw sessions_yield ("End turn; await subagent
 *             events"), Hermes a one-line status and end of turn ("give a one-line status and END YOUR TURN"), Codex
 *             wait_agent. The default.
 *   end-turn  end the turn with a status line and no wait tool (OpenClaw, Codex; for Hermes this is the same as wait)
 *   collector OpenClaw only: sessions_spawn collect=true, then agents_wait awaitResults=true
 *   full      open the review skill file, dispatch a testing specialist and the adversarial reader, wait as in wait;
 *             a short delay is fine. Used to record exposure fixtures.
 *
 * Verdicts (canary.json "verdict"): waited (every dispatched reader's report reached the main session before it ended and
 * the main session wrote its final answer after it), ended-early (a reader started, the session ended without its
 * report), reader-never-ran (the dispatch was accepted but the reader never made a model call), spawn-refused (the
 * harness refused every dispatch), not-dispatched (no dispatch in the transcript), gap (the transcript was unreadable).
 *
 * Output under --out (default <tmpdir>/wait-canary/<harness>-<scenario>-<time>): workspace/, state/ and logs/ as a
 * trial lays them out, fake-requests.ndjson, proxy-usage.ndjson, proxy.log, ledger.sqlite, timeline.txt (the transcript
 * rows that decide the verdict, with ids and timestamps) and canary.json.
 *
 * Exit codes: 0 waited; 3 the harness did not wait for the reader (any other verdict): a harness finding, not a canary
 * failure; 4 skipped (no docker, or the image is not built); 2 infrastructure failure (the proxy or the fake did not
 * start, the bind failed, the proxy refused a model call, or a key other than the dummy reached the fake); 64 usage. Refused
 * lines that name no model on a route other than messages or responses are the harness's metadata probes (Hermes polls
 * /api/tags, /v1/models, /api/show and others at every start, see harnesses/hermes/README.md); they cost $0, are counted
 * as proxy.metadata_probes and are not an infrastructure failure.
 */
import { Database } from 'bun:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFakeReaderModel, type Rule } from './fake-reader-model.ts';
import { ExposureGap, readSession, readersOf, type Harness, type ReaderMap, type SessionRead } from './exposure.ts';
import { readCodex } from './exposure.ts';

export const MAIN = 'CANARY-MAIN-TASK', READER = 'CANARY-READER-TASK', READER2 = 'CANARY-ADV-TASK';
export const REPORT = 'CANARY-REPORT-7Q', REPORT2 = 'CANARY-REPORT-ADV';
export const TESTING_PROMPT = READER + ': you are the testing specialist. Read the checklist at review/specialists/testing.md and report what you find in the diff.';
export const ADV_PROMPT = READER2 + ': Think like an attacker and a chaos engineer. Find the ways this diff fails in production and report them.';
export const CANARY_MAP: ReaderMap = { schema_version: 1, gstack: { repo: 'garrytan/gstack', sha: '4bee369d4a417fb82c6d43c0b79351428305ef10' }, checklists: { 'review/specialists/testing.md': 'testing' }, adversarial: ['Think like an attacker and a chaos engineer'] };
export type CanaryHarness = 'openclaw' | 'hermes' | 'codex';
export type Scenario = 'wait' | 'end-turn' | 'collector' | 'full';
export const SKILL_PATHS: Record<CanaryHarness, string> = {
  openclaw: '/harness-state/openclaw/skills/gstack/skills/gstack-review/SKILL.md',
  hermes: 'gstack-review',
  codex: '/harness-state/codex/skills/gstack-review/SKILL.md',
};
const RUNID_RE = 'runId[^0-9a-f]{1,20}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

/** The fake model's rules for one harness and scenario. Order matters: the first rule a request meets answers it. */
export function canaryRules(h: CanaryHarness, s: Scenario, delay: number): Rule[] {
  const full = s === 'full';
  const prompts = full ? [TESTING_PROMPT, ADV_PROMPT] : [TESTING_PROMPT];
  const rules: Rule[] = [
    { id: 'final', when: { contains: [MAIN, REPORT, ...(full ? [REPORT2] : [])] }, reply: { text: 'CANARY-FINAL: the readers returned ' + (full ? REPORT + ' and ' + REPORT2 : REPORT) + '.\n' + '\u0060\u0060\u0060json\n[]\n\u0060\u0060\u0060' } },
    { id: 'reader', when: { contains: READER, absent: [MAIN, READER2] }, delay_s: delay, reply: { text: REPORT + ': testing reader report, no findings.' } },
    { id: 'reader-adv', when: { contains: READER2, absent: [MAIN, READER] }, delay_s: delay, reply: { text: REPORT2 + ': adversarial reader report, no findings.' } },
  ];
  if (full) {
    const skill: Rule['reply'] = h === 'openclaw' ? { tool: 'read', input: { path: SKILL_PATHS.openclaw } }
      : h === 'hermes' ? { tool: 'skill_view', input: { name: SKILL_PATHS.hermes } }
      : { custom_tool: 'exec', code: 'const r = await tools.exec_command({"cmd":"cat ' + SKILL_PATHS.codex + '","login":false});\ntext(JSON.stringify(r));' };
    rules.push({ id: 'skill', when: { user_contains: MAIN, absent: ['Pre-Landing PR Review', READER] }, times: 1, reply: skill });
  }
  if (h === 'openclaw') {
    const collect = s === 'collector';
    for (const [i, p] of prompts.entries()) rules.push({ id: 'spawn' + (i + 1), when: { user_contains: MAIN, ...(i ? { contains: READER } : {}), absent: i ? READER2 : READER }, times: 1,
      reply: { tool: 'tool_call', input: { id: 'sessions_spawn', args: { task: p, label: i ? 'adversarial reader' : 'testing reader', ...(collect ? { collect: true } : {}) } } } });
    if (s === 'collector') rules.push({ id: 'wait', when: { contains: READER }, times: 1, reply: { tool: 'tool_call', input: { id: 'agents_wait', args: { ids: ['{{re:' + RUNID_RE + '}}'], awaitResults: true } } } });
    if (s === 'wait' || s === 'full') rules.push({ id: 'wait', when: { contains: READER }, times: 1, reply: { tool: 'sessions_yield', input: {} } });
  } else if (h === 'hermes') {
    rules.push({ id: 'spawn', when: { user_contains: MAIN, absent: READER }, times: 1, reply: { tool: 'delegate_task', input: { tasks: prompts.map(p => ({ goal: p, context: 'You are one reader of a code review. Report findings in plain text.' })) } } });
  } else {
    for (const [i, p] of prompts.entries()) rules.push({ id: 'spawn' + (i + 1), when: { user_contains: MAIN, ...(i ? { contains: READER } : {}), absent: i ? READER2 : READER }, times: 1,
      reply: { tool: 'spawn_agent', namespace: 'collaboration', input: { task_name: i ? 'adversarial_reader' : 'testing_reader', message: p, fork_turns: 'none' } } });
    if (s !== 'end-turn') rules.push({ id: 'wait', when: { contains: READER }, times: 4, reply: { tool: 'wait_agent', namespace: 'collaboration', input: { timeout_ms: Math.max(60_000, (delay + 120) * 1000) } } });
  }
  rules.push({ id: 'waiting', when: { contains: READER }, reply: { text: 'Waiting for the reader' + (full ? 's\'' : '\'s') + ' report.' } });
  return rules;
}

export const INSTRUCTION = MAIN + ': this is a keyless canary. Dispatch the reader(s) with your own subagent tool, wait for every report, then write your final answer quoting them.\n';

export type Verdict = 'waited' | 'ended-early' | 'reader-never-ran' | 'spawn-refused' | 'not-dispatched' | 'gap';
/** The verdict from the harness's own transcript (read by exposure.ts) and whether each reader made its model call. */
export function verdictOf(s: SessionRead | ExposureGap, readerCalls: number): Verdict {
  if (s instanceof ExposureGap) return 'gap';
  if (!s.launches.length) return 'not-dispatched';
  const started = s.launches.filter(l => l.started);
  if (!started.length) return 'spawn-refused';
  if (started.every(l => l.returned)) return 'waited';
  return readerCalls === 0 ? 'reader-never-ran' : 'ended-early';
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sh = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
export function dockerReady(image: string): string | null {
  const info = sh('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (info.status !== 0) return 'docker is not available';
  if (sh('docker', ['image', 'inspect', image]).status !== 0) return 'image ' + image + ' is not built (docker build -t harness-eval/<h>:dev harnesses/<h>, then the overlay per harnesses/README.md "gstack overlay images")';
  return null;
}

/** The rows that decide the verdict, one line each with its id and time. */
function timeline(h: CanaryHarness, out: string): string[] {
  try {
    if (h === 'hermes') {
      const db = new Database(join(out, 'state', 'hermes', 'state.db'), { readonly: true });
      try {
        const rows = db.query('select m.id, m.session_id, s.parent_session_id, m.role, m.tool_name, m.finish_reason, m.display_kind, m.timestamp, substr(m.content, 1, 140) as c from messages m left join sessions s on s.id = m.session_id order by m.id').all() as Array<Record<string, any>>;
        return rows.map(r => 'messages id ' + r.id + ' ' + new Date(r.timestamp * 1000).toISOString() + ' session ' + r.session_id + (r.parent_session_id ? ' (child of ' + r.parent_session_id + ')' : ' (main)') + ' ' + r.role + (r.tool_name ? ' ' + r.tool_name : '') + (r.finish_reason ? ' finish=' + r.finish_reason : '') + (r.display_kind ? ' display_kind=' + r.display_kind : '') + ': ' + String(r.c ?? '').replace(/\s+/g, ' '));
      } finally { db.close(); }
    }
    if (h === 'openclaw') {
      const db = new Database(join(out, 'state', 'openclaw', 'exec', 'agents', 'main', 'agent', 'openclaw-agent.sqlite'), { readonly: true });
      try {
        const rows = db.query('select session_id, seq, created_at, event_json, event_zstd from transcript_events order by session_id, seq').all() as Array<Record<string, any>>;
        return rows.flatMap(r => {
          const ev = JSON.parse(r.event_json ?? new TextDecoder().decode(Bun.zstdDecompressSync(r.event_zstd)));
          if (ev.type !== 'message') return [];
          const m = ev.message ?? {};
          const body = JSON.stringify(m.content ?? m.details ?? '').replace(/\\+"/g, '"');
          const pick = /"status"\s*:\s*"(\w+)"/.exec(body)?.[1];
          const err = /"error"\s*:\s*"([^"]+)"/.exec(body)?.[1];
          const calls = Array.isArray(m.content) ? m.content.filter((b: any) => b?.type === 'toolCall').map((b: any) => b.name + (b.arguments?.id ? ':' + b.arguments.id : '')).join(',') : '';
          return ['transcript_events session ' + String(r.session_id).slice(0, 8) + ' seq ' + r.seq + ' ' + new Date(Number(r.created_at)).toISOString() + ' ' + m.role + (m.customType ? ' ' + m.customType : '') + (m.toolName ? ' ' + m.toolName : '') + (calls ? ' calls ' + calls : '') + (m.stopReason ? ' stop=' + m.stopReason : '') + (pick ? ' status=' + pick : '') + (err ? ' error=' + err : '')];
        });
      } finally { db.close(); }
    }
    const s = readCodex(out);
    return s.files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l, i) => [JSON.parse(l), i] as const)
      .filter(([j]) => j.type === 'session_meta' || ['function_call', 'function_call_output', 'agent_message', 'custom_tool_call', 'task_complete'].includes(j.payload?.type) || (j.payload?.type === 'message' && j.payload?.role === 'assistant'))
      .map(([j, i]) => f.split('/').pop() + ' line ' + (i + 1) + ' ' + j.timestamp + ' ' + (j.type === 'session_meta' ? 'session_meta parent=' + (j.payload.parent_thread_id ?? 'none') + ' agent_path=' + (j.payload.agent_path ?? '/root') : j.payload.type + ' ' + (j.payload.name ?? j.payload.author ?? '') + ' ' + JSON.stringify(j.payload.arguments ?? j.payload.output ?? j.payload.content ?? j.payload.last_agent_message ?? '').slice(0, 140))));
  } catch (e) { return ['timeline unavailable: ' + (e as Error).message]; }
}

export interface CanaryResult {
  harness: CanaryHarness; image: string; scenario: Scenario; delay_s: number; out: string; started_at: string; ended_at: string; exit_code: number | null;
  verdict: Verdict; launches: SessionRead['launches']; readers: string[]; reader_calls: number; reader_report_sent_at: string[]; final_text_seen: boolean;
  proxy: { forwarded: number; refused: number; refused_model_calls: number; metadata_probes: number; usage_lines: number; dummy_key_only: boolean; status: unknown }; gap: string | null; timeline: string[]; note: string;
}

export function refusals(usage: string[]): { refused_model_calls: number; metadata_probes: number } {
  let refused_model_calls = 0, metadata_probes = 0;
  for (const line of usage) {
    let j: { outcome?: string; model?: string | null; route?: string };
    try { j = JSON.parse(line); } catch { refused_model_calls++; continue; }
    if (j.outcome !== 'refused') continue;
    if (j.model || /\/(messages|responses|chat\/completions)$/.test(j.route ?? '')) refused_model_calls++;
    else metadata_probes++;
  }
  return { refused_model_calls, metadata_probes };
}

export async function runCanary(o: { harness: CanaryHarness; scenario: Scenario; image: string; delay: number; budget: number; out: string }): Promise<CanaryResult> {
  const { harness: h, out } = o;
  for (const d of ['workspace', 'state', 'logs']) mkdirSync(join(out, d), { recursive: true });
  writeFileSync(join(out, 'workspace', 'instruction.md'), INSTRUCTION);
  if (h === 'codex' && o.scenario === 'full') {
    // Codex has no gstack overlay in harness-evals; a stand-in review SKILL.md with gstack's markers lets the full
    // scenario record a real Codex skill read in Codex's own rollout format.
    mkdirSync(join(out, 'state', 'codex', 'skills', 'gstack-review'), { recursive: true });
    writeFileSync(join(out, 'state', 'codex', 'skills', 'gstack-review', 'SKILL.md'), '---\nname: gstack-review\ndescription: stand-in for the canary (not gstack)\n---\n<!-- AUTO-GENERATED from SKILL.md.tmpl: a canary stand-in, not gstack -->\n# Pre-Landing PR Review\n');
  }
  const gw = sh('docker', ['network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}']).stdout.trim() || '172.17.0.1';
  const fake = startFakeReaderModel({ host: gw, port: 0, rules: canaryRules(h, o.scenario, o.delay), log: join(out, 'fake-requests.ndjson') });
  const provider = h === 'codex' ? 'openai' : 'anthropic';
  const model = h === 'codex' ? 'gpt-6.1-sol' : 'claude-opus-5-5';
  const dummy = provider === 'openai' ? 'sk-canary-dummy' : 'sk-ant-canary-dummy';
  const control = randomBytes(18).toString('hex');
  const slot = 'canary-' + h;
  const token = 'trial-token:' + slot + '.' + randomBytes(8).toString('hex');
  const runId = 'canary-' + h + '-' + Date.now();
  const proxyLog: string[] = [];
  const proxy = spawn(process.execPath, ['runner/proxy/metering-proxy.ts', '--listen', gw + ':0', '--control-token', control, '--budget-ledger', join(out, 'ledger.sqlite'), '--lease-usd', '25', '--run-id', runId, '--new-run',
    '--allow-models', provider + ':' + model, '--upstream', provider + '=http://' + gw + ':' + fake.port, '--max-output-tokens', '128000', '--usage-log', join(out, 'proxy-usage.ndjson')],
    { cwd: resolve(import.meta.dir, '..', '..'), env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: out, ANTHROPIC_API_KEY: 'sk-ant-canary-dummy', OPENAI_API_KEY: 'sk-canary-dummy' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise<number>((ok, bad) => {
    const t = setTimeout(() => bad(new Error('the metering proxy did not start: ' + proxyLog.join(''))), 20_000);
    const on = (b: Buffer) => { proxyLog.push(b.toString()); const m = /on [\d.]+:(\d+);/.exec(proxyLog.join('')); if (m) { clearTimeout(t); ok(Number(m[1])); } };
    proxy.stderr!.on('data', on); proxy.stdout!.on('data', on);
    proxy.on('exit', c => { clearTimeout(t); bad(new Error('the metering proxy exited ' + c + ': ' + proxyLog.join(''))); });
  });
  const bind = await fetch('http://' + gw + ':' + port + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control }, body: JSON.stringify({ slot, key: 'trial-token:' + slot, token }) });
  if (!bind.ok) throw new Error('bind failed: ' + bind.status + ' ' + await bind.text());
  const started_at = new Date().toISOString();
  // The fake answers from this process's event loop, so the harness runs as an async child, never spawnSync.
  const child = spawn('timeout', ['-k', '10', String(o.budget + 60), 'docker', 'run', '-i', '--rm', '--user', process.getuid!() + ':' + process.getgid!(), '--network', 'bridge', '--add-host', 'host.docker.internal:host-gateway',
    '-v', join(out, 'workspace') + ':/workspace', '-v', join(out, 'state') + ':/harness-state', '-v', join(out, 'logs') + ':/he-logs',
    '-e', 'HE_MODEL_BASE_URL=http://host.docker.internal:' + port + '/' + slot + '/' + provider, '-e', 'HE_MODEL_API_KEY=' + token, '-e', 'HE_MODEL_NAME=' + model,
    '-e', 'HE_TIME_BUDGET_S=' + o.budget, '-e', 'HE_LOG_DIR=/he-logs', '-e', 'HE_SESSION_STATE_DIR=/harness-state', '-e', 'HE_TASK_SLICE=coding', '-e', 'HE_TRIAL_ID=' + slot, o.image, 'run'],
    { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { stdout: '', stderr: '', status: null as number | null };
  child.stdout!.on('data', b => { run.stdout += b.toString(); });
  child.stderr!.on('data', b => { run.stderr += b.toString(); });
  run.status = await new Promise<number | null>(r => child.on('exit', c => r(c)));
  const ended_at = new Date().toISOString();
  writeFileSync(join(out, 'logs', 'docker-stdout.log'), run.stdout ?? '');
  writeFileSync(join(out, 'logs', 'docker-stderr.log'), run.stderr ?? '');
  await new Promise(r => setTimeout(r, 1500));
  proxy.kill('SIGTERM');
  await new Promise(r => proxy.once('exit', r));
  fake.stop();
  writeFileSync(join(out, 'proxy.log'), proxyLog.join(''));
  const status = (() => { const m = /stopped: (\{.*\})/.exec(proxyLog.join('')); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } })();
  const usage = existsSync(join(out, 'proxy-usage.ndjson')) ? readFileSync(join(out, 'proxy-usage.ndjson'), 'utf8').split('\n').filter(Boolean) : [];
  const dummyHashes = new Set([sha256(dummy), sha256('Bearer ' + dummy)]);
  const reqs = fake.requests.filter(r => r.wire !== 'other');
  const readerReqs = reqs.filter(r => r.rule === 'reader' || r.rule === 'reader-adv');
  let session: SessionRead | ExposureGap;
  try { session = readSession(h as Harness, out); } catch (e) { if (!(e instanceof ExposureGap)) throw e; session = e; }
  const verdict = verdictOf(session, readerReqs.length);
  const launches = session instanceof ExposureGap ? [] : session.launches;
  const res: CanaryResult = {
    harness: h, image: o.image, scenario: o.scenario, delay_s: o.delay, out, started_at, ended_at, exit_code: run.status, verdict, launches,
    readers: [...new Set(launches.filter(l => l.started).flatMap(l => readersOf(l.prompt, CANARY_MAP)))].sort(),
    reader_calls: readerReqs.length, reader_report_sent_at: readerReqs.map(r => r.sent_at ?? 'never sent (the client went away)'),
    final_text_seen: reqs.some(r => r.rule === 'final'),
    proxy: { forwarded: status?.forwarded ?? 0, refused: status?.refused ?? 0, ...refusals(usage), usage_lines: usage.length, dummy_key_only: reqs.every(r => r.authorization_sha256 !== null && dummyHashes.has(r.authorization_sha256)), status },
    gap: session instanceof ExposureGap ? session.message : null, timeline: timeline(h, out), note: session instanceof ExposureGap ? '' : session.note,
  };
  writeFileSync(join(out, 'timeline.txt'), res.timeline.join('\n') + '\n');
  writeFileSync(join(out, 'canary.json'), JSON.stringify(res, null, 2) + '\n');
  return res;
}

export const DEFAULT_IMAGE: Record<string, string> = { openclaw: 'harness-eval/openclaw:gstack-4bee369d', hermes: 'harness-eval/hermes:gstack-4bee369d', 'hermes-chat': 'harness-eval/hermes:gstack-4bee369d-chat', codex: 'harness-eval/codex:dev' };

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const h = one('--harness') as CanaryHarness | undefined;
  const scenario = (one('--scenario') ?? 'wait') as Scenario;
  const mode = one('--hermes-mode') ?? 'oneshot';
  const valid = h && ['openclaw', 'hermes', 'codex'].includes(h) && ['wait', 'end-turn', 'collector', 'full'].includes(scenario) && (scenario !== 'collector' || h === 'openclaw') && ['oneshot', 'chat'].includes(mode);
  if (!valid) { console.error('usage: wait-canary.ts --harness openclaw|hermes|codex [--scenario wait|end-turn|collector|full] [--image <tag>] [--hermes-mode oneshot|chat] [--delay 120] [--budget 420] [--out <dir>]'); process.exit(64); }
  const image = one('--image') ?? DEFAULT_IMAGE[h === 'hermes' && mode === 'chat' ? 'hermes-chat' : h];
  const skip = dockerReady(image);
  if (skip) { console.log('SKIP: ' + skip); process.exit(4); }
  const delay = Number(one('--delay') ?? 120), budget = Number(one('--budget') ?? Math.max(240, delay * 2 + 180));
  const out = resolve(one('--out') ?? join(tmpdir(), 'wait-canary', h + (h === 'hermes' ? '-' + mode : '') + '-' + scenario + '-' + new Date().toISOString().replace(/[:.]/g, '-')));
  try {
    const r = await runCanary({ harness: h, scenario, image, delay, budget, out });
    const infra = !r.proxy.dummy_key_only || r.proxy.refused_model_calls > 0 || r.proxy.forwarded === 0;
    console.log(JSON.stringify({ harness: r.harness, image: r.image, scenario: r.scenario, verdict: r.verdict, readers: r.readers, reader_calls: r.reader_calls, reader_report_sent_at: r.reader_report_sent_at, final_text_seen: r.final_text_seen, exit_code: r.exit_code, started_at: r.started_at, ended_at: r.ended_at, proxy: { forwarded: r.proxy.forwarded, refused: r.proxy.refused, refused_model_calls: r.proxy.refused_model_calls, metadata_probes: r.proxy.metadata_probes, dummy_key_only: r.proxy.dummy_key_only }, launches: r.launches.map(l => ({ locator: l.locator, started: l.started, refused: l.refused, returned: l.returned, note: l.note })), gap: r.gap, out: r.out }, null, 2));
    process.exit(infra ? 2 : r.verdict === 'waited' ? 0 : 3);
  } catch (e) {
    console.error('wait-canary: infrastructure failure: ' + (e as Error).message);
    process.exit(2);
  }
}
