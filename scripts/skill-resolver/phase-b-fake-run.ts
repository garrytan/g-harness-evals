#!/usr/bin/env bun
// Keyless proof that a Phase B (skill-requests) trial runs end to end through the runner in a real harness image (internal-task): a
// fake model endpoint plays a script, the runner (capture mode, dummy keys, no spend) runs one skill-requests cell with one
// request row on the harness's serve entry (a member DM in the v0.1 world), writes got-skill.json from the request bodies the proxy held and scrubs the trial directory. Uncounted: run ids
// start with anatomy-capture-.
//
//   bun scripts/skill-resolver/phase-b-fake-run.ts --harness claude-code --model anthropic:claude-opus-5-5 --kind read \
//       --skill accelerate --catalog <manifest.json> --set <set.jsonl> --request <id> --out <dir> [--config skills-native]
//       [--arm native] [--image <tag>] [--cap 6]
//
// --kind read   the harness's own skill read once (Claude Code: the Skill tool; Codex: a shell cat of $CODEX_HOME/skills/<skill>/SKILL.md;
//               QM: the skills tool; OpenClaw: skills_read; Hermes: skill_view), then "done"
// --kind none   only "done"
// --kind loop   a harmless shell call on every request, forever (--loop); the cell's request_cap must end it
// --kind gstack one read of a gstack install's SKILL.md (GSTACK_SKILL, ~/.claude/skills/gstack), outside the catalog, then "done": the record's
//               clean_arm must count it and say contaminated
// Prints one line: PHASEB_FAKE <harness> <kind> termination=<t> model_requests=<n> got_skill=<names> leaks=<n> kept=<files>
// leaks counts files under the run directory holding the request text, its JSON-escaped form or one of its 8-word shingles.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { CAPTURE_DUMMY_KEYS } from '../../runner/trial/capture.ts';
import { readRequestSet, redactRequest } from '../../runner/trial/skill-requests.ts';

const ROOT = resolve(import.meta.dir, '../..');
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const walk = (d: string): string[] => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]) : [];

export const GSTACK_SKILL = '/root/.claude/skills/gstack/SKILL.md';

export function script(harness: string, kind: 'read' | 'none' | 'loop' | 'gstack', skill: string): unknown[] {
  const done = harness === 'qm' ? { text: 'done', match: {} } : { text: 'done' };
  if (kind === 'none') return [done];
  if (kind === 'gstack') {
    if (harness === 'claude-code') return [{ call: 'Read', arguments: { file_path: GSTACK_SKILL } }, done];
    if (harness === 'qm') return [{ call: 'execute', arguments: { command: 'cat ' + GSTACK_SKILL, purpose: 'read' } }, done];
    if (harness === 'hermes') return [{ call: 'read_file', arguments: { path: GSTACK_SKILL } }, done];
    return [{ tool: 'cat ' + GSTACK_SKILL }, done];
  }
  if (kind === 'loop') {
    if (harness === 'claude-code') return [{ call: 'Bash', arguments: { command: 'echo again', description: 'again' } }];
    if (harness === 'qm') return [{ call: 'execute', arguments: { command: 'echo again', purpose: 'again' } }];
    return [{ tool: 'echo again' }];
  }
  if (harness === 'claude-code') return [{ call: 'Skill', arguments: { skill } }, done];
  if (harness === 'codex') return [{ tool: 'cat "$CODEX_HOME/skills/' + skill + '/SKILL.md"' }, done];
  if (harness === 'qm') return [{ call: 'skills', arguments: { action: 'read', name: skill } }, done];
  if (harness === 'openclaw') return [{ call: 'skills_read', arguments: { name: skill } }, done];
  return [{ call: 'skill_view', arguments: { name: skill } }, done];
}

async function waitFor(ok: () => boolean, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (ok()) return; await Bun.sleep(200); }
  throw new Error('timed out waiting for ' + what);
}

export async function fakeTrial(o: { harness: string; model: string; kind: 'read' | 'none' | 'loop' | 'gstack'; skill: string; catalog: string; set: string; request: string; out: string; config?: string; arm: string; image?: string; cap: number }) {
  const provider = o.model.slice(0, o.model.indexOf(':')) as 'anthropic' | 'openai';
  const out = join(o.out, o.harness + '-' + (o.config ?? 'default') + '-' + o.kind);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'script.json'), JSON.stringify(script(o.harness, o.kind, o.skill)));
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port as number;
  probe.stop(true);
  // The fake's own request log holds the request bodies by design; it stays beside the run directory, never inside it.
  const fakeOut = openSync(join(out, 'fake.out'), 'a');
  const fake = spawn(process.execPath, [join(ROOT, provider === 'anthropic' ? 'scripts/gsta-135/fake-anthropic.ts' : 'tests/fixtures/fake-responses.ts'), '--host', '127.0.0.1', '--port', String(port),
    '--log', join(out, 'fake.ndjson'), '--script', join(out, 'script.json'), '--require-key-prefix', CAPTURE_DUMMY_KEYS[provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'], '--max-requests', '60', '--max-seconds', '1500', ...(o.kind === 'loop' ? ['--loop'] : [])],
    { env: ENV, stdio: ['ignore', fakeOut, fakeOut] });
  try {
    await waitFor(() => readFileSync(join(out, 'fake.out'), 'utf8').includes('listening'), 20_000, 'the fake model endpoint');
    const runId = ('anatomy-capture-phaseb-' + o.harness + '-' + o.kind + '-' + Date.now().toString(36)).toLowerCase();
    const cell = { id: o.harness + '-' + o.arm, harness: o.harness, model: o.model, slice: 'skill-requests', split: 'dev', tasks: [o.request], repetitions: 1, skill_arm: o.arm,
      requests: o.set, request_set: 'P', catalog: o.catalog, request_cap: o.cap, ...(o.config ? { config: o.config } : {}),
      ceiling: { input_tokens: 200_000, output_tokens: 32_000 }, ...(o.harness === 'codex' ? { network: 'internal' } : {}),
      ...(o.harness === 'qm' ? { utility_models: [provider === 'anthropic' ? 'anthropic:claude-haiku-5-5' : 'openai:gpt-5.6-luna'] } : {}) };
    writeFileSync(join(out, 'prereg.json'), JSON.stringify({ schema_version: 1, run_id: runId, question: 'internal-task Phase B wiring proof: uncounted and keyless, against a fake model endpoint', tasks: {}, cells: [cell], wall_clock_s: { 'skill-requests': 900 }, spend_cap_usd: 5, drop_order: [], minimum_v01: [] }, null, 1));
    const runDir = join(out, 'run');
    const plan = spawnSync(process.execPath, ['runner/run.ts', 'plan', '--prereg', join(out, 'prereg.json'), '--out', runDir], { cwd: ROOT, env: ENV, encoding: 'utf8' });
    writeFileSync(join(out, 'plan.log'), plan.stdout + plan.stderr);
    if (plan.status !== 0) throw new Error('plan exited ' + plan.status + ': ' + (plan.stdout + plan.stderr).slice(-600));
    const run = spawnSync(process.execPath, ['runner/run.ts', 'run', '--manifest', join(runDir, 'manifest.json'), '--lease-usd', '5', '--new-lease', '--max-output-tokens', '128000', '--capture-upstream', provider + '=http://127.0.0.1:' + port, ...(o.image ? ['--image', o.image] : [])],
      { cwd: ROOT, env: ENV, encoding: 'utf8', timeout: 1_800_000 });
    writeFileSync(join(out, 'run.log'), (run.stdout ?? '') + (run.stderr ?? ''));
    if (run.status !== 0) throw new Error('run exited ' + run.status + ': ' + (run.stderr ?? '').slice(-800));
    const record = JSON.parse(readFileSync(join(runDir, 'trials.jsonl'), 'utf8').trim().split('\n')[0]!) as TrialRecord;
    const row = readRequestSet(o.set).find((r) => r.id === o.request)!;
    const texts = [row.text, ...(row.prev_user_text ? [row.prev_user_text] : [])];
    const leaks = walk(runDir).filter((f) => !f.endsWith('.sqlite') && redactRequest(readFileSync(f, 'utf8'), texts).lines > 0).map((f) => f.slice(runDir.length + 1));
    const fakeRequests = existsSync(join(out, 'fake.ndjson')) ? readFileSync(join(out, 'fake.ndjson'), 'utf8').split('\n').filter(Boolean).length : 0;
    return { out, runDir, record, leaks, fakeRequests };
  } finally { fake.kill('SIGTERM'); }
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string, d?: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const [harness, model, kind, skill, catalog, set, request, out] = ['--harness', '--model', '--kind', '--skill', '--catalog', '--set', '--request', '--out'].map((k) => v(k));
  if (!harness || !model || !kind || !skill || !catalog || !set || !request || !out) { console.error('usage: phase-b-fake-run.ts --harness <h> --model <provider:model> --kind read|none|loop|gstack --skill <name> --catalog <manifest.json> --set <set.jsonl> --request <id> --out <dir> [--config <c>] [--arm native] [--image <tag>] [--cap 6]'); process.exit(2); }
  try {
    const r = await fakeTrial({ harness, model, kind: kind as 'read' | 'none' | 'loop' | 'gstack', skill, catalog: resolve(catalog), set: resolve(set), request, out: resolve(out), config: v('--config'), arm: v('--arm', 'native')!, image: v('--image'), cap: Number(v('--cap', '6')) });
    const s = r.record.skill_request;
    console.log('PHASEB_FAKE ' + harness + ' ' + kind + ' termination=' + r.record.termination + ' model_requests=' + (s?.model_requests ?? '-') + '/' + (s?.request_cap ?? '-') + ' fake_requests=' + r.fakeRequests + ' got_skill=' + (s?.got_skill.join(',') || '-') + ' gstack_reads=' + (s?.clean_arm?.gstack_reads ?? '-') + ' contaminated=' + (s?.clean_arm?.contaminated ?? '-')
      + ' leaks=' + r.leaks.length + (r.leaks.length ? '(' + r.leaks.join(',') + ')' : '') + ' kept=' + (s?.scrubbed.kept.join(',') ?? '-') + ' removed=' + (s?.scrubbed.removed ?? '-') + (r.record.error ? ' error=' + JSON.stringify(r.record.error.slice(0, 300)) : '') + ' dir=' + r.out);
  } catch (e) { console.log('PHASEB_FAKE ' + harness + ' ' + kind + ' ERROR ' + (e as Error).message.split('\n')[0]); process.exit(1); }
}
