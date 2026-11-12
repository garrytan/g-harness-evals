#!/usr/bin/env bun
// Keyless proof that a set T trial runs end to end through the runner in a real harness image (internal-task): a fake model
// endpoint plays one shell call that writes an attempt's files (a task's oracle/ or obvious/ overlay) into the harness's
// working directory, then "done"; the runner (capture mode, dummy keys, no spend) runs the skill-tasks cell, copies the
// workspace out and grades it with the set T checker. Uncounted: run ids start with anatomy-capture-.
//
//   bun scripts/skill-resolver/set-t-fake-run.ts --harness claude-code --model anthropic:claude-opus-5-5 \
//       --tasks t15-invoice-export-decision,t34-billing-refactor-pause --attempts oracle,obvious --out ~/.capy/work/internal-task/sett-fake
//       [--arm native] [--config skills-native] [--attempts none] [--image <tag>]
//
// OpenClaw, Claude Code, Codex and Hermes run on the serve entry: the runner seeds start/ and instruction.md into the trial's
// workspace, the member sends the request as one DM, and graded=trial/workspace says the checker read <trialDir>/workspace.
//
// QM: the adapter makes the actor's default sandbox from the seeded sandbox image before the turn (skill-tasks only), so the
// scripted execute runs there and capture.sh copies its /root/workspace back for grading. On QM the line adds
// qm_default_sandbox (from the trial record) and qm_sandbox_saw=<n of m>: the top-level start/ entries and instruction.md
// that the command's ls -A printed inside the sandbox.
//
// --attempts none plays only "done": the harness writes nothing, which shows the start/ files reach the workspace and come
// back. Prints one line per trial: SETT_FAKE <harness> <task> <attempt> termination=<t> success=<0|1> used_it=<0|1>
// instruction_md=<seeded|changed|absent> start_files=<n present of m>, and SETT_FAKE_OK or SETT_FAKE_FAIL at the end.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { CAPTURE_DUMMY_KEYS } from '../../runner/trial/capture.ts';

const ROOT = resolve(import.meta.dir, '../..');
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const TASKS = join(ROOT, 'tasks', 'skill-resolver', 'T', 'tasks');

const walk = (d: string): string[] => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]) : [];

/** One shell command that lays an attempt's files into the current directory, from a base64 tar.gz. */
export function writeCommand(dir: string): string {
  const tar = spawnSync('tar', ['-czf', '-', '--owner=0', '--group=0', '-C', dir, '.'], { maxBuffer: 1 << 26 });
  if (tar.status !== 0) throw new Error('tar failed for ' + dir);
  return "printf %s '" + tar.stdout.toString('base64') + "' | base64 -d | tar -xzf - --no-same-owner && echo wrote";
}

/** The fake's script: the harness's own shell or file-writing tool once, then "done". */
export function script(harness: string, command: string | null): unknown[] {
  if (!command) return [harness === 'qm' ? { text: 'done', match: {} } : { text: 'done' }];
  if (harness === 'claude-code') return [{ call: 'Bash', arguments: { command, description: 'write files' } }, { text: 'done' }];
  if (harness === 'qm') return [{ call: 'execute', arguments: { command: 'cd /root/workspace && ls -A && ' + command, purpose: 'Writing the files' } }, { text: 'done', match: {} }];
  return [{ tool: command }, { text: 'done' }];
}

async function waitFor(ok: () => boolean, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (ok()) return; await Bun.sleep(200); }
  throw new Error('timed out waiting for ' + what);
}

export async function fakeTrial(o: { harness: string; model: string; task: string; attempt: 'oracle' | 'obvious' | 'none'; out: string; arm: string; image?: string; config?: string }) {
  const provider = o.model.slice(0, o.model.indexOf(':')) as 'anthropic' | 'openai';
  const out = join(o.out, o.harness + '-' + provider + (o.config ? '-' + o.config : ''), o.task + '-' + o.attempt);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'script.json'), JSON.stringify(script(o.harness, o.attempt === 'none' ? null : writeCommand(join(TASKS, o.task, o.attempt)))));
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port as number;
  probe.stop(true);
  const fakeOut = openSync(join(out, 'fake.out'), 'a');
  const fake = spawn(process.execPath, [join(ROOT, provider === 'anthropic' ? 'scripts/gsta-135/fake-anthropic.ts' : 'tests/fixtures/fake-responses.ts'), '--host', '127.0.0.1', '--port', String(port),
    '--log', join(out, 'fake.ndjson'), '--script', join(out, 'script.json'), '--require-key-prefix', CAPTURE_DUMMY_KEYS[provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'], '--max-requests', '60', '--max-seconds', '1500'],
    { env: ENV, stdio: ['ignore', fakeOut, fakeOut] });
  try {
    await waitFor(() => readFileSync(join(out, 'fake.out'), 'utf8').includes('listening'), 20_000, 'the fake model endpoint');
    const runId = ('anatomy-capture-sett-' + o.harness + '-' + o.task.slice(0, 3) + '-' + o.attempt + '-' + Date.now().toString(36)).toLowerCase();
    const cell = { id: o.harness + '-' + o.arm, harness: o.harness, model: o.model, slice: 'skill-tasks', split: 'dev', tasks: [o.task], repetitions: 1, skill_arm: o.arm, ...(o.config ? { config: o.config } : {}),
      ceiling: { input_tokens: 200_000, output_tokens: 32_000 }, ...(o.harness === 'codex' ? { network: 'internal' } : {}),
      ...(o.harness === 'qm' ? { utility_models: [provider === 'anthropic' ? 'anthropic:claude-haiku-5-5' : 'openai:gpt-5.6-luna'] } : {}) };
    writeFileSync(join(out, 'prereg.json'), JSON.stringify({ schema_version: 1, run_id: runId, question: 'internal-task set T wiring proof: uncounted and keyless, against a fake model endpoint', tasks: {}, cells: [cell], wall_clock_s: { 'skill-tasks': 3600 }, spend_cap_usd: 5, drop_order: [], minimum_v01: [] }, null, 1));
    const runDir = join(out, 'run');
    const plan = spawnSync(process.execPath, ['runner/run.ts', 'plan', '--prereg', join(out, 'prereg.json'), '--out', runDir], { cwd: ROOT, env: ENV, encoding: 'utf8' });
    writeFileSync(join(out, 'plan.log'), plan.stdout + plan.stderr);
    if (plan.status !== 0) throw new Error('plan exited ' + plan.status + ': ' + (plan.stdout + plan.stderr).slice(-600));
    const run = spawnSync(process.execPath, ['runner/run.ts', 'run', '--manifest', join(runDir, 'manifest.json'), '--lease-usd', '5', '--new-lease', '--max-output-tokens', '128000', '--capture-upstream', provider + '=http://127.0.0.1:' + port, ...(o.image ? ['--image', o.image] : [])],
      { cwd: ROOT, env: ENV, encoding: 'utf8', timeout: 1_800_000 });
    writeFileSync(join(out, 'run.log'), (run.stdout ?? '') + (run.stderr ?? ''));
    if (run.status !== 0) throw new Error('run exited ' + run.status + ': ' + (run.stderr ?? '').slice(-800));
    const record = JSON.parse(readFileSync(join(runDir, 'trials.jsonl'), 'utf8').trim().split('\n')[0]!) as TrialRecord;
    const ws = record.paths.workspace ?? join(runDir, 'trials', 'x');
    const start = walk(join(TASKS, o.task, 'start')).map((f) => relative(join(TASKS, o.task, 'start'), f));
    const present = start.filter((f) => existsSync(join(ws, f)) && statSync(join(ws, f)).isFile() && readFileSync(join(ws, f)).equals(readFileSync(join(TASKS, o.task, 'start', f))));
    const requests = readFileSync(join(out, 'fake.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const played = requests.filter((r) => r.played).map((r) => r.played.missing ? 'missing' : 'played');
    // QM: the command's own output shows what the agent saw in its sandbox: the ls -A of /root/workspace and the tar's "wrote".
    const results = requests.flatMap((r) => (r.body?.messages ?? []).flatMap((m: { content: unknown }) => Array.isArray(m.content) ? m.content : []))
      .filter((c: { type?: string }) => c.type === 'tool_result').map((c: { content: unknown }) => typeof c.content === 'string' ? c.content : JSON.stringify(c.content));
    const listing = (results.at(-1) ?? '').split('\n');
    const top = [...new Set([...start.map((f) => f.split('/')[0]!), 'instruction.md'])];
    const sandbox = { saw: top.filter((n) => listing.includes(n)).length, of: top.length, wrote: listing.includes('wrote') };
    const graded = record.paths.workspace === join(record.paths.dir, 'workspace') ? 'trial/workspace' : (record.paths.workspace ?? '-');
    return { out, record, start: start.length, present: present.length, played, sandbox, graded };
  } finally { fake.kill('SIGTERM'); }
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string, d?: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const harness = v('--harness'), model = v('--model'), tasks = v('--tasks')?.split(','), out = v('--out');
  if (!harness || !model || !tasks || !out) { console.error('usage: set-t-fake-run.ts --harness <h> --model <provider:model> --tasks <id,...> --out <dir> [--attempts oracle,obvious] [--arm native] [--config <c>] [--image <tag>]'); process.exit(2); }
  const attempts = (v('--attempts', 'oracle,obvious')!).split(',') as Array<'oracle' | 'obvious' | 'none'>;
  let ok = true;
  for (const task of tasks) for (const attempt of attempts) {
    try {
      const r = await fakeTrial({ harness, model, task, attempt, out: resolve(out), arm: v('--arm', 'native')!, image: v('--image'), config: v('--config') });
      const s = r.record.set_t;
      const qmOk = harness !== 'qm' || (s?.qm_default_sandbox === true && (attempt === 'none' || (r.sandbox.saw === r.sandbox.of && r.sandbox.wrote)));
      const servedOk = harness === 'qm' || r.graded === 'trial/workspace';
      const want = qmOk && servedOk && (attempt === 'oracle' ? s?.success === true && s.used_it === true : attempt === 'obvious' ? s?.used_it === false : s?.used_it === false && r.present === r.start);
      if (!want || r.record.termination !== 'completed') ok = false;
      console.log('SETT_FAKE ' + harness + ' ' + task + ' ' + attempt + ' termination=' + r.record.termination + ' success=' + Number(!!s?.success) + ' used_it=' + Number(!!s?.used_it) + ' instruction_md=' + (s?.instruction_md ?? '-') + ' start_files=' + r.present + '/' + r.start + ' arm=' + (s?.arm ?? '-') + ' graded=' + r.graded + ' fake_turns=' + r.played.join(',') + (harness === 'qm' ? ' qm_default_sandbox=' + Number(!!s?.qm_default_sandbox) + (attempt === 'none' ? '' : ' qm_sandbox_saw=' + r.sandbox.saw + '/' + r.sandbox.of) : '') + (want ? '' : ' UNEXPECTED') + ' dir=' + r.out);
    } catch (e) { ok = false; console.log('SETT_FAKE ' + harness + ' ' + task + ' ' + attempt + ' ERROR ' + (e as Error).message.split('\n')[0]); }
  }
  console.log(ok ? 'SETT_FAKE_OK' : 'SETT_FAKE_FAIL');
  process.exit(ok ? 0 : 1);
}
