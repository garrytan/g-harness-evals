#!/usr/bin/env bun
// Tool discipline, step 2: what a harness says back when the model makes a bad tool call. Keyless.
//
// Plays five scripted model turns into one real trial (runner capture mode: the real world, world-MCP and
// metering proxy with dummy keys, the proxy's upstream pointed at scripts/gsta-135/fake-anthropic.ts), then
// reads the fake's request log and pulls, for each scripted call, the tool_result block the harness sent back
// in its next request: verbatim (token-like strings scrubbed), is_error, the exit code a shell reply shows,
// which of the next request's offered tool names the reply text names, and the world events.jsonl lines
// written between the call and the reply (H3: does a malformed world-MCP call leave a line).
//
//   bun scripts/tool-discipline/reply-probe.ts --target <openclaw|hermes-oneshot|hermes-chat|claude-code|qm-pi>
//       [--out <dir>] [--write <dir>]          run a trial; --write puts <dir>/<target>.json
//   bun scripts/tool-discipline/reply-probe.ts --target <t> --extract <out dir> [--write <dir>]
//                                              re-read a finished capture without running anything (image and commits come from the capture's probe-run.json)
//
// Nothing is paid: the fake refuses any credential that is not the capture dummy.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const DUMMY_ANTHROPIC = 'sk-ant-capture-dummy';
const BRIDGE = '172.17.0.1';
const MODEL = 'claude-opus-5-5';
const TASK = 'si-01-marrow-agrisupply-site';
const DM = 'DANATOM0001';
const SHELL = '/bin/true 2>&1 | head -40';

export type Turn = { raw_tool: string; input: Record<string, unknown> } | { text: string };
export type Step = { label: string; extra?: true; turn: Turn };
/** entry run-trial: harnesses/run-trial.sh with a gsta-135 task and no world (for images that implement only the run entry). */
type Target = { harness: string; mode: string; image: string; config?: string; entry?: 'runner' | 'run-trial'; steps: Step[] };

const step = (label: string, raw_tool: string, input: Record<string, unknown>, extra?: true): Step =>
  ({ label, ...(extra ? { extra } : {}), turn: { raw_tool, input } });
const missingArg = { channel: DM };
const wrongId = { channel: '@nobody', text: 'tool-discipline probe' };
const first = (): Step[] => [step('1 unknown tool', 'frobnicate', {}), step('2 skills_read', 'skills_read', { name: 'review' })];
const MISSING = '3 world call missing a required argument (text)';
const WRONG = '4 world call with a wrong channel';
const SHELL_STEP = '5 shell call piping a helper';

export const TARGETS: Record<string, () => Target> = {
  openclaw: () => ({
    harness: 'openclaw', mode: 'default', image: 'harness-eval/openclaw:dev', steps: [...first(),
      step('extra: world call by the bare tool name', 'tool_call', { id: 'post_message', args: wrongId }, true),
      step(MISSING, 'tool_call', { id: 'world__post_message', args: missingArg }),
      step(WRONG, 'tool_call', { id: 'world__post_message', args: wrongId }),
      step(SHELL_STEP, 'exec', { command: SHELL })],
  }),
  'hermes-oneshot': () => ({ harness: 'hermes', mode: 'oneshot', image: 'harness-eval/hermes:dev', steps: hermes() }),
  'hermes-chat': () => ({ harness: 'hermes', mode: 'chat (gstack-none overlay, run-trial path, no world)', image: 'harness-eval/hermes:gstack-none-chat', entry: 'run-trial', steps: hermes() }),
  'claude-code': () => ({
    harness: 'claude-code', mode: 'default', image: 'harness-eval/claude-code:dev', steps: [...first(),
      step('extra: load the deferred world tool', 'ToolSearch', { query: 'select:mcp__world__post_message' }, true),
      step(MISSING, 'mcp__world__post_message', missingArg),
      step(WRONG, 'mcp__world__post_message', wrongId),
      step(SHELL_STEP, 'Bash', { command: SHELL })],
  }),
  'qm-pi': () => ({
    harness: 'qm', mode: 'pi', config: 'pi', image: 'harness-eval/qm:dev', steps: [...first(),
      step(MISSING, 'mcp_call', { server: 'world', tool: 'post_message', args: missingArg }),
      step(WRONG, 'mcp_call', { server: 'world', tool: 'post_message', args: wrongId }),
      step(SHELL_STEP, 'execute', { command: SHELL, purpose: 'tool-discipline probe' })],
  }),
};
function hermes(): Step[] {
  return [...first(),
    step(MISSING, 'tool_call', { calls: [{ name: 'mcp__world__post_message', arguments: missingArg }] }),
    step(WRONG, 'tool_call', { calls: [{ name: 'mcp__world__post_message', arguments: wrongId }] }),
    step(SHELL_STEP, 'terminal', { command: SHELL })];
}

/** Replaces token-like strings: provider keys, the trial token, bearer values and long opaque runs (hex digests and run ids stay). */
export function scrub<T>(value: T): T {
  const s = JSON.stringify(value)
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[scrubbed]')
    .replace(/trial-token:[^\s"'\\]+/g, 'trial-token:[scrubbed]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/=-]{8,}/gi, '$1[scrubbed]')
    .replace(/\b(?![0-9a-f]+\b)(?=[A-Za-z0-9_]*\d)(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{32,}\b/g, '[scrubbed]');
  return JSON.parse(s) as T;
}

/** The exit code a shell reply shows the model, with the text it was read from, or null. */
export function exitCode(text: string): { code: number; from: string } | null {
  const m = text.match(/"?exit[ _]?code"?\s*[:=]?\s*(-?\d+)/i) ?? text.match(/exited with (?:code|status) (-?\d+)/i)
    ?? text.match(/\bexit(?: status)? (-?\d+)\b/i);
  return m ? { code: Number(m[1]), from: m[0] } : null;
}

const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
const blocks = (content: unknown): Record<string, unknown>[] =>
  Array.isArray(content) ? content.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object') : [];
const textOf = (content: unknown): string => typeof content === 'string' ? content
  : blocks(content).map((b) => (typeof b.text === 'string' ? b.text : '')).join('\n');
const toolNames = (body: Record<string, unknown> | undefined): string[] =>
  (Array.isArray(body?.tools) ? body!.tools as Record<string, unknown>[] : []).map((t) => String(t.name ?? ''));
const escape = (s: string) => s.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');

export type Req = { at: string; sent_at: string | null; body?: Record<string, unknown>; played: Record<string, unknown> | null };
export type Ev = Record<string, unknown> & { wall_ts?: string };

/** One entry per scripted step: the call as played and the harness's verbatim reply in its next request. */
export function extract(steps: Step[], requests: Req[], events: Ev[]) {
  return steps.map((s, i) => {
    const out: Record<string, unknown> = { label: s.label, ...(s.extra ? { extra: true } : {}), played: s.turn };
    if (!('raw_tool' in s.turn)) return out;
    const raw = s.turn;
    const playedAt = requests.findIndex((r) => r.played && canon(r.played) === canon(raw));
    if (playedAt < 0) return { ...out, outcome: 'not played: the harness made no eligible request for this turn' };
    const id = 'toolu_fake_' + (i + 1);
    const from = Date.parse(requests[playedAt]!.sent_at ?? requests[playedAt]!.at);
    const window = (to?: string) => events.filter((e) => !!e.wall_ts && Date.parse(e.wall_ts) >= from && (!to || Date.parse(e.wall_ts) <= Date.parse(to)));
    let useId = id, nextAt = -1, result: Record<string, unknown> | null = null;
    for (let k = playedAt + 1; k < requests.length && !result; k++) {
      const msgs = Array.isArray(requests[k]!.body?.messages) ? requests[k]!.body!.messages as Record<string, unknown>[] : [];
      const all = msgs.flatMap((m) => blocks(m.content));
      const use = all.find((b) => b.type === 'tool_use' && (b.id === id || (b.name === raw.raw_tool && canon(b.input) === canon(raw.input))));
      if (use) useId = String(use.id);
      const hit = all.find((b) => b.type === 'tool_result' && b.tool_use_id === useId);
      if (hit) { result = hit; nextAt = k; }
    }
    if (!result) return { ...out, request_index: playedAt, tool_use_id: id, tool_result: null, outcome: 'no tool_result for this call in any later request', world_events: scrub(window()) };
    const text = textOf(result.content);
    const offered = toolNames(requests[nextAt]!.body);
    const named = offered.filter((n) => n && new RegExp('(^|[^A-Za-z0-9_])' + escape(n) + '([^A-Za-z0-9_]|$)').test(text));
    return {
      ...out,
      request_index: playedAt,
      next_request_index: nextAt,
      tool_use_id: useId,
      tool_result: scrub(result),
      is_error: result.is_error ?? null,
      text_bytes: Buffer.byteLength(text),
      ...(s.label === SHELL_STEP ? { exit_code: exitCode(text) } : {}),
      called_name_offered_next: offered.includes(raw.raw_tool),
      offered_names_in_text: named,
      world_events: scrub(window(requests[nextAt]!.at)),
    };
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const git = (...a: string[]) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const ndjson = <T>(p: string): T[] => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : [];
function findFile(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
  }
  return null;
}

async function capture(target: Target, out: string): Promise<Record<string, unknown>> {
  mkdirSync(out, { recursive: true });
  const env = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: homedir() };
  const port = 8700 + Math.floor(Math.random() * 80);
  const scriptPath = join(out, 'script.json');
  writeFileSync(scriptPath, JSON.stringify([...target.steps.map((s) => s.turn), { text: 'done' }], null, 1));
  const runTrial = target.entry === 'run-trial';
  const fake = spawn(process.execPath, [join(ROOT, 'scripts/gsta-135/fake-anthropic.ts'), '--host', BRIDGE, '--port', String(port),
    '--log', join(out, 'fake.ndjson'), '--script', scriptPath, '--require-key-prefix', runTrial ? 'trial-token:' : DUMMY_ANTHROPIC, '--max-requests', '200', '--max-seconds', '900'],
    { env, stdio: ['ignore', openSync(join(out, 'fake.out'), 'a'), openSync(join(out, 'fake.out'), 'a')] });
  try {
    const deadline = Date.now() + 20_000;
    while (!(existsSync(join(out, 'fake.out')) && readFileSync(join(out, 'fake.out'), 'utf8').includes('listening'))) {
      if (Date.now() > deadline) throw new Error('fake-anthropic did not start');
      await Bun.sleep(200);
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).toLowerCase();
    if (runTrial) {
      const taskDir = join(out, 'task');
      const made = spawnSync('bash', [join(ROOT, 'scripts/gsta-135/make-task.sh'), '1', taskDir], { cwd: ROOT, env, encoding: 'utf8' });
      const trialId = 'tool-discipline-' + target.harness + '-' + stamp;
      const run = made.status !== 0 ? made : spawnSync('bash', ['harnesses/run-trial.sh', '--harness', target.harness, '--image', target.image, '--task', taskDir,
        '--trial-id', trialId, '--base-url', 'http://host.docker.internal:' + port, '--api-key', 'trial-token:placeholder', '--model', MODEL,
        '--time-budget', '300', '--out', join(out, 'run')], { cwd: ROOT, env, encoding: 'utf8', timeout: 1_200_000 });
      writeFileSync(join(out, 'run.log'), (run.stdout ?? '') + (run.stderr ?? ''));
      return { entry: 'run-trial', trial_id: trialId, gsta135_task: 1, run_exit: run.status, world: false };
    }
    const runId = 'anatomy-capture-tool-discipline-' + target.harness + '-' + stamp;
    const cell: Record<string, unknown> = {
      id: target.harness + '-tool-discipline', harness: target.harness, model: 'anthropic:' + MODEL, slice: 'multiuser', split: 'dev',
      task_set: 'v0.3', tasks: [TASK], repetitions: 1, ceiling: { input_tokens: 200000, output_tokens: 128000 },
      ...(target.config ? { config: target.config } : {}),
    };
    const preregPath = join(out, 'prereg.json');
    writeFileSync(preregPath, JSON.stringify({ schema_version: 1, run_id: runId, question: 'internal-task keyless tool-discipline reply probe', tasks: {}, cells: [cell], wall_clock_s: 3600, spend_cap_usd: 5 }, null, 2));
    const runDir = join(out, 'run');
    const plan = spawnSync(process.execPath, ['runner/run.ts', 'plan', '--prereg', preregPath, '--out', runDir], { cwd: ROOT, env, encoding: 'utf8' });
    writeFileSync(join(out, 'plan.log'), plan.stdout + plan.stderr);
    let runStatus: number | null = null;
    if (plan.status === 0) {
      const run = spawnSync(process.execPath, ['runner/run.ts', 'run', '--manifest', join(runDir, 'manifest.json'), '--lease-usd', '5', '--new-lease',
        '--max-output-tokens', '128000', '--capture-upstream', 'anthropic=http://' + BRIDGE + ':' + port, '--image', target.image],
        { cwd: ROOT, env, encoding: 'utf8', timeout: 1_800_000 });
      writeFileSync(join(out, 'run.log'), (run.stdout ?? '') + (run.stderr ?? ''));
      runStatus = run.status;
    }
    return { entry: 'runner', run_id: runId, plan_exit: plan.status, run_exit: runStatus, world: true };
  } finally {
    fake.kill('SIGTERM');
  }
}

if (import.meta.main) {
  const name = arg('target');
  if (!name || !TARGETS[name]) {
    console.error('usage: reply-probe.ts --target <' + Object.keys(TARGETS).join('|') + '> [--out <dir>] [--extract <dir>] [--write <dir>]');
    process.exit(64);
  }
  const target = TARGETS[name]!();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const out = resolve(arg('extract') ?? arg('out') ?? join(homedir(), '.capy/work/harn18/probe', name + '-' + stamp));
  const inspect = (f: string) => spawnSync('docker', ['image', 'inspect', '-f', f, target.image], { encoding: 'utf8' }).stdout.trim();
  const label = (k: string) => inspect('{{index .Config.Labels "' + k + '"}}').replace('<no value>', '') || null;
  type Provenance = { image_id: string | null; harness_version: string | null; harness_commit: string | null; harness_evals_commit: string; dirty: boolean };
  let ran: Awaited<ReturnType<typeof capture>> & { provenance?: Provenance };
  if (arg('extract')) ran = JSON.parse(readFileSync(join(out, 'probe-run.json'), 'utf8'));
  else {
    const provenance = {
      image_id: inspect('{{.Id}}') || null, harness_version: label('harness-eval.version'), harness_commit: label('harness-eval.commit'),
      harness_evals_commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0,
    };
    ran = { ...(await capture(target, out)), provenance };
    writeFileSync(join(out, 'probe-run.json'), JSON.stringify(ran, null, 2));
  }
  const { provenance, ...run } = ran;
  const requests = ndjson<Req>(join(out, 'fake.ndjson')).filter((r) => r.body && Array.isArray(r.body.messages));
  const eventsPath = findFile(join(out, 'run'), 'events.jsonl');
  const events = eventsPath ? ndjson<Ev>(eventsPath) : [];
  const record = {
    schema: 'tool-discipline-replies/1',
    target: name, harness: target.harness, mode: target.mode, model: MODEL, task: TASK,
    image: target.image,
    ...(provenance ?? { image_id: null, harness_version: null, harness_commit: null, harness_evals_commit: null, dirty: null,
      provenance_note: 'probe-run.json predates saved provenance, so the image and commit at capture are unknown' }),
    run,
    fake_log_sha256: existsSync(join(out, 'fake.ndjson')) ? sha(join(out, 'fake.ndjson')) : null,
    agent_requests: requests.length,
    events_lines: events.length,
    note: 'tool_result is the block the harness sent in the request after the scripted call, read from the fake model log, with token-like strings replaced by [scrubbed]. world_events are the world events.jsonl lines written between the scripted call and that request.',
    turns: extract(target.steps, requests, events),
  };
  const dest = arg('write') ? join(resolve(arg('write')!), name + '.json') : join(out, name + '.json');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(record, null, 2) + '\n');
  const replied = record.turns.filter((t) => 'tool_result' in t && t.tool_result).length;
  console.log('PROBE: ' + name + ' run=' + ran.run_exit + ' requests=' + requests.length + ' replies=' + replied + '/' + target.steps.length + ' out=' + out + ' record=' + dest);
}
