// QM serve turns go to core as a member's message: origin human with the ts of the message the runner posted. Core
// defaults a turn with no origin to direct (src/api/app-turn.ts at the pin), and a direct turn skips the live-person
// paths a Slack member's message takes. A timer turn (kind "timer", posted by nobody) sends no origin and stays direct. serve_turn is cut out of harnesses/qm/adapter.sh and run under bash with a
// scrubbed environment (env -i plus an allowlist, never a login shell) against a fake core that checks the signature.

import { afterAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dir, '..');
const QM_API = join(ROOT, 'harnesses', 'qm', 'qm-api.mjs');
const NODE = spawnSync('node', ['--version']).status === 0;
const SECRET = 'test-signing-secret';
const tmp = mkdtempSync(join(tmpdir(), 'he-qm-origin-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function fakeCore() {
  const turns: Record<string, unknown>[] = [];
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = await req.text();
    const want = 'v0=' + createHmac('sha256', SECRET).update('v0:' + (req.headers.get('x-timestamp') ?? '') + ':' + req.method + '\n' + path + '\n' + body).digest('hex');
    if (req.headers.get('x-signature') !== want) return Response.json({ error: 'bad_signature' }, { status: 401 });
    if (req.method !== 'POST' || path !== '/v1/turns') return Response.json({ error: 'not_found' }, { status: 404 });
    turns.push(JSON.parse(body));
    return Response.json({ status: 'ok', reply: 'done' });
  } });
  return { url: 'http://127.0.0.1:' + server.port, turns, stop: () => server.stop(true) };
}

function serveTurnFunction(): string {
  const text = readFileSync(join(ROOT, 'harnesses', 'qm', 'adapter.sh'), 'utf8');
  const start = text.indexOf('serve_turn() {');
  const end = text.indexOf('\n}\n', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end + 3).replaceAll('/opt/harness/qm-api.mjs', QM_API);
}

const request = (turn: number, channel: { id: string; name: string; type: 'dm' | 'channel' }, ts: string) => ({
  turn, trial_id: 't1', prompt: 'Prompt ' + turn, text: 'Text ' + turn, ts, thread_ts: null, sim_now: '2026-03-02T09:00:00-08:00', time_budget_s: 30,
  actor: { member: 'avery', slack_user_id: 'U0A1', name: 'Avery Lindqvist', role: 'founder', team: null }, channel,
});

async function run(script: string, args: string[], env: Record<string, string>) {
  // Async: the fake core answers from this event loop, so a blocking spawn would starve it.
  const proc = Bun.spawn(['env', '-i', ...Object.entries(env).map(([k, v]) => k + '=' + v), 'bash', script, ...args], { stdout: 'pipe', stderr: 'pipe' });
  return { status: await proc.exited, stderr: await new Response(proc.stderr).text() };
}

describe.skipIf(!NODE)('qm serve turns carry origin human', () => {
  test('a DM and a channel message each post origin human with the message ts; a timer turn posts none', async () => {
    const core = fakeCore();
    try {
      const dir = join(tmp, 'serve');
      const logs = join(dir, 'logs');
      mkdirSync(join(logs, 'turns'), { recursive: true });
      writeFileSync(join(dir, 'dm.json'), JSON.stringify(request(1, { id: 'D01', name: 'avery', type: 'dm' }, '1772470800.000100')));
      writeFileSync(join(dir, 'ch.json'), JSON.stringify(request(2, { id: 'C01', name: 'general', type: 'channel' }, '1772470860.000200')));
      writeFileSync(join(dir, 'timer.json'), JSON.stringify({ ...request(3, { id: 'C01', name: 'general', type: 'channel' }, '1772470860.000200'), kind: 'timer', timer: { id: 'tm1', due: '2026-03-02T10:00:00-08:00', reason: 'digest', note: null, set_at: '2026-03-02T09:01:00-08:00' } }));
      const script = join(dir, 'serve.sh');
      writeFileSync(script, serveTurnFunction() + '\nset -e\nserve_turn "$1" dm:avery turn-0001 30 || exit 1\nserve_turn "$2" channel:C01 turn-0002 30 || exit 1\nserve_turn "$3" channel:C01 turn-0003 30 || exit 1\n');
      const r = await run(script, [join(dir, 'dm.json'), join(dir, 'ch.json'), join(dir, 'timer.json')], { PATH: process.env.PATH ?? '/usr/bin:/bin', HE_LOG_DIR: logs, QM_CORE_URL: core.url, QM_SIGNING_SECRET: SECRET });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(core.turns).toEqual([
        { surface: 'harness-eval', actor: { externalId: 'U0A1', displayName: 'Avery Lindqvist' }, conversation: { kind: 'dm', threadRef: 'dm:avery' }, origin: { kind: 'human', messageTs: '1772470800.000100' }, text: 'Prompt 1' },
        { surface: 'harness-eval', actor: { externalId: 'U0A1', displayName: 'Avery Lindqvist' }, conversation: { kind: 'channel', threadRef: 'channel:C01', channelRef: 'C01', channelName: 'general' }, origin: { kind: 'human', messageTs: '1772470860.000200' }, text: 'Prompt 2' },
        { surface: 'harness-eval', actor: { externalId: 'U0A1', displayName: 'Avery Lindqvist' }, conversation: { kind: 'channel', threadRef: 'channel:C01', channelRef: 'C01', channelName: 'general' }, text: 'Prompt 3' },
      ]);
      expect(readFileSync(join(logs, 'turns', 'turn-0002.reply.txt'), 'utf8')).toBe('done');
    } finally { core.stop(); }
  });

  test('a job with no origin posts none, so core keeps its own default', async () => {
    const core = fakeCore();
    try {
      const dir = join(tmp, 'plain');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'prompt.md'), 'Hello');
      writeFileSync(join(dir, 'job.json'), JSON.stringify({ actor: { externalId: 'U1' }, conversation: { kind: 'dm', threadRef: 't1' }, text_file: join(dir, 'prompt.md') }));
      const proc = Bun.spawn(['env', '-i', 'PATH=' + (process.env.PATH ?? '/usr/bin:/bin'), 'node', QM_API, 'turn', core.url, SECRET, join(dir, 'job.json'), '30'], { stdout: 'pipe', stderr: 'pipe' });
      expect(await proc.exited).toBe(0);
      expect(core.turns).toEqual([{ surface: 'harness-eval', actor: { externalId: 'U1' }, conversation: { kind: 'dm', threadRef: 't1' }, text: 'Hello' }]);
    } finally { core.stop(); }
  });
});
