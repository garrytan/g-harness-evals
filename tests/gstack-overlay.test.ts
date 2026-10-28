// internal-task overlay: the evidence extractor on fixture transcripts and the
// wrappers' budget arithmetic. Keyless; no docker.
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classify, extract, helperRun } from '../scripts/gsta-135/evidence.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'gsta135-'));
const call = (tool: string, args: unknown) => ({ tool, args, locator: 'x', file: 'f', sha256: 'deadbeef' });

describe('classify', () => {
  test('OpenClaw: router read, sub-skill read and the helper exec', () => {
    const router = classify(call('read', { path: '/harness-state/openclaw/skills/gstack/SKILL.md' }), 'openclaw');
    expect(router.map(e => e.kind)).toEqual(['skill_open']);
    const sub = classify(call('read', { path: '/harness-state/openclaw/skills/gstack/skills/gstack-review/SKILL.md' }), 'openclaw');
    expect(sub[0]).toMatchObject({ kind: 'skill_open', detail: expect.stringContaining('gstack-review') });
    const exec = classify(call('exec', { command: 'GSTACK_ROOT="/opt/gstack"; "$GSTACK_ROOT/bin/gstack-skill-start" --skill review --model claude' }), 'openclaw');
    expect(exec.map(e => e.kind)).toEqual(['helper_run']);
    expect(classify(call('skills_read', { name: 'gstack' }), 'openclaw')[0].kind).toBe('skill_open');
  });
  test('Hermes: skill_view and terminal', () => {
    expect(classify(call('skill_view', { name: 'gstack-investigate' }), 'hermes')[0]).toMatchObject({ kind: 'skill_open', detail: 'skill_view gstack-investigate' });
    expect(classify(call('terminal', { command: '/opt/gstack/bin/gstack-skill-start --skill investigate --model claude' }), 'hermes')[0].kind).toBe('helper_run');
  });
  test('an installer-only mention is a gstack_path, not an open or a run', () => {
    const e = classify(call('exec', { command: 'ls /harness-state/openclaw/skills' }), 'openclaw');
    expect(e).toEqual([]);
    const g = classify(call('exec', { command: 'cat /opt/gstack/VERSION' }), 'openclaw');
    expect(g.map(x => x.kind)).toEqual(['gstack_path']);
    expect(classify(call('read', { path: '/workspace/README.md' }), 'openclaw')).toEqual([]);
  });
});

function openclawFixture(events: unknown[], dir = tmp()): string {
  const d = join(dir, 'state', 'openclaw', 'exec', 'agents', 'main', 'agent');
  mkdirSync(d, { recursive: true });
  const db = new Database(join(d, 'openclaw-agent.sqlite'));
  db.run('create table transcript_events (session_id text, seq integer, event_json text, event_zstd blob, created_at text)');
  events.forEach((e, i) => db.run('insert into transcript_events values (?, ?, ?, null, ?)', ['s1', i, JSON.stringify(e), 'now']));
  db.close();
  return dir;
}
const assistant = (content: unknown[], stopReason = content.some((b: any) => b.type === 'toolCall') ? 'toolUse' : 'stop') => ({ type: 'message', message: { role: 'assistant', content, stopReason } });
const toolResult = (name: string) => ({ type: 'message', message: { role: 'toolResult', toolName: name, content: [{ type: 'text', text: 'ok' }] } });

describe('extract openclaw', () => {
  test('a real open and exec, in order, with file and sha', () => {
    const dir = openclawFixture([
      { type: 'session', id: 's1' },
      { type: 'message', message: { role: 'user', content: 'Review the uncommitted change in this repo before I merge it.' } },
      assistant([{ type: 'toolCall', id: '1', name: 'read', arguments: { path: '/harness-state/openclaw/skills/gstack/SKILL.md' } }]),
      toolResult('read'),
      assistant([{ type: 'toolCall', id: '2', name: 'read', arguments: { path: '/harness-state/openclaw/skills/gstack/skills/gstack-review/SKILL.md' } }]),
      toolResult('read'),
      assistant([{ type: 'toolCall', id: '3', name: 'exec', arguments: { command: '"/opt/gstack/bin/gstack-skill-start" --skill review --model claude' } }]),
      toolResult('exec'),
      assistant([{ type: 'text', text: 'Done. (If you had not installed gstack I would say: run /opt/gstack/bin/gstack-skill-start yourself.)' }]),
    ]);
    const ev = extract('openclaw', dir);
    expect(ev.transcript).toBe('complete');
    expect(ev.tool_calls).toBe(3);
    expect(ev.skill_open).toMatchObject({ detail: 'read /harness-state/openclaw/skills/gstack/SKILL.md', locator: expect.stringContaining('seq 2') });
    expect(ev.sub_skill_open!.detail).toContain('gstack-review');
    expect(ev.helper_run).toMatchObject({ kind: 'helper_run', locator: expect.stringContaining('seq 6') });
    expect(ev.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.helper_run!.sha256).toBe(ev.files[0].sha256);
  });
  test('a quoted example in assistant text is not an event', () => {
    const dir = openclawFixture([
      { type: 'message', message: { role: 'user', content: 'Write a two-line poem about the sea.' } },
      assistant([{ type: 'text', text: 'Waves fold the light; the shore keeps count.\n(You could also run /opt/gstack/bin/gstack-skill-start --skill review.)' }]),
    ]);
    const ev = extract('openclaw', dir);
    expect(ev.transcript).toBe('complete');
    expect(ev.events).toEqual([]);
    expect(ev.skill_open).toBeNull();
  });
  test('a missing store is missing; a transcript ending mid-tool is truncated', () => {
    expect(extract('openclaw', tmp()).transcript).toBe('missing');
    const user = { type: 'message', message: { role: 'user', content: 'The test suite fails. Find out why.' } };
    const exec = assistant([{ type: 'toolCall', id: '1', name: 'exec', arguments: { command: 'python3 -m unittest' } }]);
    const afterResult = extract('openclaw', openclawFixture([user, exec, toolResult('exec')]));
    expect(afterResult.transcript).toBe('truncated');
    expect(afterResult.note).toContain('last toolResult');
    expect(afterResult.skill_open).toBeNull();
    const cutOnToolUse = extract('openclaw', openclawFixture([user, exec]));
    expect(cutOnToolUse.transcript).toBe('truncated');
    expect(cutOnToolUse.note).toContain('last assistant:toolUse, 1 tool call(s) without a result');
    const cutByLength = extract('openclaw', openclawFixture([user, assistant([{ type: 'text', text: 'The failure is in' }], 'length')]));
    expect(cutByLength.transcript).toBe('truncated');
    expect(extract('openclaw', openclawFixture([user, exec, toolResult('exec'), assistant([{ type: 'text', text: 'Fixed.' }])])).transcript).toBe('complete');
  });
  test('a helper is run only in command position', () => {
    expect(helperRun('cat /opt/gstack/bin/gstack-skill-start | head')).toBeNull();
    expect(helperRun('grep -n gstack-skill-start /x/SKILL.md; echo /opt/gstack/bin/gstack-skill-start')).toBeNull();
    expect(helperRun("echo 'example; /opt/gstack/bin/gstack-skill-start --skill review'")).toBeNull();
    expect(helperRun("cat > run.sh <<'EOF'\n/opt/gstack/bin/gstack-skill-start --skill review\nEOF\nls")).toBeNull();
    expect(helperRun('command -v gstack-skill-start; bash -n /opt/gstack/bin/gstack-skill-start')).toBeNull();
    expect(helperRun('cd /workspace && timeout -k 5 30 /opt/gstack/bin/gstack-skill-start --skill review')).toBe('/opt/gstack/bin/gstack-skill-start');
    expect(helperRun('GSTACK_BIN=/opt/gstack/bin; "$GSTACK_BIN/gstack-skill-start" --skill review')).toBe('$GSTACK_BIN/gstack-skill-start');
    expect(helperRun('${GSTACK_BIN}/gstack-skill-start --skill review')).toBe('${GSTACK_BIN}/gstack-skill-start');
    expect(helperRun('bun --no-env-file --config=/dev/null run /opt/gstack/bin/gstack-next-version')).toBe('/opt/gstack/bin/gstack-next-version');
    expect(helperRun("bash -c 'cd /workspace && /opt/gstack/bin/gstack-skill-start --skill review'")).toBe('/opt/gstack/bin/gstack-skill-start');
    expect(helperRun('cd /opt/gstack/bin && ./gstack-skill-start --skill review')).toBe('./gstack-skill-start');
    expect(helperRun('x=$(/opt/gstack/bin/gstack-skill-start --skill review)')).toBe('/opt/gstack/bin/gstack-skill-start');
    expect(helperRun('out="$(/opt/gstack/bin/gstack-skill-start --skill review)"; echo "$out"')).toBe('/opt/gstack/bin/gstack-skill-start');
    expect(helperRun('if /opt/gstack/bin/gstack-skill-start --skill review; then echo ok; fi')).toBe('/opt/gstack/bin/gstack-skill-start');
    expect(helperRun('sudo -u app /opt/gstack/bin/gstack-skill-start')).toBe('/opt/gstack/bin/gstack-skill-start');
    expect(helperRun('bash -lc "/opt/gstack/bin/gstack-skill-start --skill review"')).toBe('/opt/gstack/bin/gstack-skill-start');
    expect(helperRun('echo "see /opt/gstack/bin/gstack-skill-start"')).toBeNull();
    expect(helperRun('grep -n "$(basename x)" /opt/gstack/bin/gstack-skill-start; echo $(date) /opt/gstack/bin/gstack-skill-start')).toBeNull();
    expect(helperRun('echo hi # "$(/opt/gstack/bin/gstack-skill-start)"')).toBeNull();
    expect(helperRun('bash -nc "/opt/gstack/bin/gstack-skill-start"')).toBeNull();
    expect(helperRun('sudo --user app /opt/gstack/bin/gstack-skill-start')).toBe('/opt/gstack/bin/gstack-skill-start');
    expect(helperRun('echo "$(x "$(/opt/gstack/bin/gstack-skill-start)")"')).toBe('/opt/gstack/bin/gstack-skill-start');
  });
  test('an empty store is missing, not an error', () => {
    const dir = tmp();
    const d = join(dir, 'state', 'openclaw', 'exec', 'agents', 'main', 'agent');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'openclaw-agent.sqlite'), '');
    expect(extract('openclaw', dir)).toMatchObject({ transcript: 'missing', note: 'empty openclaw-agent.sqlite' });
  });
});

describe('extract hermes', () => {
  test('skill_view and terminal from state.db', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'state', 'hermes'), { recursive: true });
    const db = new Database(join(dir, 'state', 'hermes', 'state.db'));
    db.run('create table messages (id integer primary key, session_id text, role text, content text, tool_call_id text, tool_calls text, tool_name text, finish_reason text)');
    const ins = (role: string, content: string, tool_calls: unknown, finish: string | null, tool_name: string | null = null) =>
      db.run('insert into messages (session_id, role, content, tool_call_id, tool_calls, tool_name, finish_reason) values (?,?,?,?,?,?,?)', ['s', role, content, null, tool_calls ? JSON.stringify(tool_calls) : null, tool_name, finish]);
    ins('user', 'Review the uncommitted change in this repo before I merge it.', null, null);
    ins('assistant', '', [{ id: 'a', type: 'function', function: { name: 'skill_view', arguments: JSON.stringify({ name: 'gstack-review' }) } }], 'tool_calls');
    ins('tool', 'skill body', null, null, 'skill_view');
    ins('assistant', '', [{ id: 'b', type: 'function', function: { name: 'terminal', arguments: JSON.stringify({ command: 'cd /workspace && /opt/gstack/bin/gstack-skill-start --skill review --model claude' }) } }], 'tool_calls');
    ins('tool', 'SKILL_START_PROTO: 1', null, null, 'terminal');
    ins('assistant', 'Review done.', null, 'stop');
    db.close();
    const ev = extract('hermes', dir);
    expect(ev.transcript).toBe('complete');
    expect(ev.skill_open).toMatchObject({ detail: 'skill_view gstack-review', locator: 'messages id 2 session s' });
    expect(ev.helper_run!.detail).toContain('/opt/gstack/bin/gstack-skill-start');
    expect(extract('hermes', tmp()).transcript).toBe('missing');
  });
  test('undecodable tool_calls or an open call make the transcript truncated', () => {
    const make = (rows: Array<[string, string, string | null, string | null]>) => {
      const dir = tmp();
      mkdirSync(join(dir, 'state', 'hermes'), { recursive: true });
      const db = new Database(join(dir, 'state', 'hermes', 'state.db'));
      db.run('create table messages (id integer primary key, session_id text, role text, content text, tool_call_id text, tool_calls text, tool_name text, finish_reason text)');
      for (const [role, content, tool_calls, finish] of rows) db.run('insert into messages (session_id, role, content, tool_call_id, tool_calls, tool_name, finish_reason) values (?,?,?,?,?,?,?)', ['s', role, content, null, tool_calls, null, finish]);
      db.close();
      return extract('hermes', dir);
    };
    const bad = make([['user', 'Find out why.', null, null], ['assistant', '', '{not json', 'tool_calls'], ['tool', 'ok', null, null], ['assistant', 'Done.', null, 'stop']]);
    expect(bad.transcript).toBe('truncated');
    expect(bad.note).toContain('1 undecodable');
    const open = make([['user', 'Find out why.', null, null], ['assistant', '', JSON.stringify([{ id: 'a', type: 'function', function: { name: 'terminal', arguments: '{"command":"ls"}' } }]), 'tool_calls']]);
    expect(open.transcript).toBe('truncated');
    expect(open.note).toContain('1 tool call(s) without a result');
  });
});

describe('wrapper budget arithmetic', () => {
  const lib = join(ROOT, 'harnesses', '_gstack', 'wrapper-lib.sh');
  function run(budget: number, elapsed: number) {
    const dir = tmp();
    const real = join(dir, 'real.sh');
    writeFileSync(real, '#!/usr/bin/env bash\necho "budget=$HE_TIME_BUDGET_S args=$*"\n');
    chmodSync(real, 0o755);
    const script = `set -euo pipefail; . "${lib}"; GSTACK_WRAP_START=$((GSTACK_WRAP_START - ${elapsed})); wrap_handoff run`;
    const r = spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH!, GSTACK_WRAP_NOW: '1700000000', HE_LOG_DIR: dir, HE_TIME_BUDGET_S: String(budget), HE_TRIAL_ID: 't', GSTACK_WRAP_REAL: real, HE_SESSION_STATE_DIR: dir }, encoding: 'utf8' });
    return { ...r, log: require('node:fs').readFileSync(join(dir, 'gstack-register.log'), 'utf8') };
  }
  test('hands the real adapter the budget less the registration time, both logged', () => {
    const r = run(600, 7);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('budget=593 args=run');
    expect(r.log).toContain('budget: given 600s, registration took 7s, handing the adapter 593s');
  });
  test('exits 2 before any model request when the registration used the budget', () => {
    const r = run(120, 120);
    expect(r.status).toBe(2);
    expect(r.log).toContain('exit 2 (harness_error) before any model request');
    expect(r.stdout).toBe('');
  });
  test('an empty setup log is a registration failure', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'setup.log'), '');
    const r = spawnSync('bash', ['-c', `set -euo pipefail; . "${lib}"; wrap_setup_ready "${join(dir, 'setup.log')}" openclaw`], { env: { PATH: process.env.PATH!, HE_LOG_DIR: dir }, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(require('node:fs').readFileSync(join(dir, 'gstack-register.log'), 'utf8')).toContain('setup printed nothing');
  });
});

describe('discovery driver', () => {
  test('the spend read survives a trial with no usage line under set -e', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'u.ndjson'), JSON.stringify({ key: 'trial-token:other', outcome: 'forwarded', status: 200, actual_usd: 0.5 }) + '\n');
    const expr = require('node:fs').readFileSync(join(ROOT, 'scripts', 'gsta-135', 'discovery.sh'), 'utf8').match(/spend=\$\(\{ grep -F[\s\S]*?from_entries\)\}'\)/)![0];
    const run = (usage: string) => spawnSync('bash', ['-c', `set -euo pipefail; trial=t1; usage="${usage}"; ${expr}; echo "$spend"`], { encoding: 'utf8' });
    const r = run(join(dir, 'u.ndjson'));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ forwarded: 0, spent: 0, unknown: 0, refused: 0, budget_refusals: 0, refusals: {} });
    expect(run(dir).status).not.toBe(0);
  });
  test('refuses to reuse a run directory, before it needs the key', () => {
    const id = 'test-reuse-' + process.pid;
    const dir = join(ROOT, 'results', 'gsta-135', 'runs', id);
    mkdirSync(dir, { recursive: true });
    try {
      const r = spawnSync('bash', [join(ROOT, 'scripts', 'gsta-135', 'discovery.sh'), '--run-id', id], { env: { PATH: process.env.PATH! }, encoding: 'utf8' });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('never reused');
      expect(r.stderr).not.toContain('ANTHROPIC_API_KEY');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('report.ts derives the refusal note, the deviations and the verdicts from the rows', () => {
    const dir = tmp();
    const base = { harness: 'openclaw', task: 1, arm: 'gstack', image: 'i', image_digest: 'd', tree: 't', tree_dirty: true, model: 'm', time_budget_s: 600, workspace_seen: true, started_at: '2026-10-28T09:54:00Z', exit_code: 0, usd_spent: 0.1, usd_reserved_unknown: 0 };
    const opened = { kind: 'skill_open', tool: 'read', detail: 'read /harness-state/openclaw/skills/gstack/SKILL.md', file: 'f', locator: 'seq 2', sha256: 'abcdef123456abcdef' };
    const rows = [
      { ...base, trial_id: 'a', termination: 'complete', requests_forwarded: 3, requests_refused: 2, budget_refusals: 0, refusals: { '403 route GET /anthropic/v1/models is not allowlisted': 2 }, requests_undrained: 1, evidence: { transcript: 'truncated', skill_open: opened, sub_skill_open: null, helper_run: null, gstack_paths: 0, tool_calls: 2, files: [], events: [opened] } },
      { ...base, trial_id: 'b', harness: 'hermes', termination: 'incomplete:budget', requests_forwarded: 1, requests_refused: 1, budget_refusals: 1, refusals: { '402 run x is over its $10 budget': 1 }, requests_undrained: null, evidence: { transcript: 'complete', skill_open: null, sub_skill_open: null, helper_run: null, gstack_paths: 0, tool_calls: 1, files: [], events: [] } },
      { ...base, trial_id: 'c', task: 2, termination: 'not_run:cap', exit_code: null, usd_spent: 0, requests_forwarded: 0, requests_refused: 0, budget_refusals: 0, refusals: {}, requests_undrained: 0, evidence: null },
    ];
    writeFileSync(join(dir, 'cells.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const r = spawnSync('bun', [join(ROOT, 'scripts', 'gsta-135', 'report.ts'), join(dir, 'cells.jsonl'), join(dir, 'report.md'), '--pin', 'p', '--run-id', 'x', '--lease-usd', '10', '--cap', '128000', '--stop', 'lease refusal during b'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const md = require('node:fs').readFileSync(join(dir, 'report.md'), 'utf8');
    expect(md).toContain('# internal-task live discovery, uncounted diagnostic (2026-10-28)');
    expect(md).toContain('4 forwarded, 3 refused (1 by the lease; 2 x 403 route GET /anthropic/v1/models is not allowlisted; 1 x 402 run x is over its $10 budget; a refusal costs nothing); 1 still in flight when their trial was finalized (cost in the ledger, not in any row); finalize failed for b');
    expect(md).toContain('- 2026-10-28: the lease ran with an output cap of 128,000 tokens');
    expect(md).toContain('1 planned cell(s) not dispatched after the lease refused a request (lease refusal during b)');
    expect(md).toContain('- 2026-10-28: the tree carried uncommitted changes');
    expect(md).toMatch(/\| a \| openclaw .* skill opened; helper run unobservable \(transcript truncated\) \|/);
    expect(md).toMatch(/\| b \| hermes .* no gstack skill opened in this trial \|/);
    expect(md).toMatch(/\| c \| openclaw .* not_run:cap \|/);
  });
});

describe('overlay files', () => {
  const sh = (p: string) => spawnSync('bash', ['-n', join(ROOT, p)], { encoding: 'utf8' });
  test('the wrappers and the preflight scripts parse', () => {
    for (const p of ['harnesses/openclaw/gstack/adapter.sh', 'harnesses/hermes/gstack/adapter.sh', 'harnesses/qm/gstack/adapter.sh', 'scripts/gsta-135/preflight.sh', 'scripts/gsta-135/make-task.sh', 'scripts/gsta-135/discovery.sh']) {
      expect({ p, status: sh(p).status, stderr: sh(p).stderr }).toEqual({ p, status: 0, stderr: '' });
    }
    for (const p of ['harnesses/openclaw/gstack/adapter.sh', 'harnesses/hermes/gstack/adapter.sh', 'harnesses/qm/gstack/adapter.sh']) {
      const src = require('node:fs').readFileSync(join(ROOT, p), 'utf8');
      expect(src).toContain('wrapper-lib.sh');
      expect(src).toContain('wrap_handoff');
    }
  });
  test('the three overlay Dockerfiles build FROM the counted :dev image at one pinned commit and Bun version', () => {
    for (const p of ['harnesses/openclaw/gstack/Dockerfile', 'harnesses/hermes/gstack/Dockerfile', 'harnesses/qm/gstack/Dockerfile']) {
      const h = p.split('/')[1];
      const src = require('node:fs').readFileSync(join(ROOT, p), 'utf8');
      expect(src).toContain(`FROM harness-eval/${h}:dev`);
      expect(src).toContain('ARG GSTACK_COMMIT');
      expect(src).toContain('test "$(git rev-parse HEAD)" = "${GSTACK_COMMIT}"');
      expect(src).toContain('bash -s "bun-v${BUN_VERSION}"');
      expect(src).toContain('wrapper-lib.sh');
    }
  });
  test('make-task.sh seeds the three tasks with the spec sentences', () => {
    const dir = tmp();
    const fs = require('node:fs');
    for (const t of [1, 2, 3]) {
      const r = spawnSync('bash', [join(ROOT, 'scripts', 'gsta-135', 'make-task.sh'), String(t), join(dir, 't' + t)], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(fs.existsSync(join(dir, 't' + t, 'task.toml'))).toBe(true);
    }
    expect(fs.readFileSync(join(dir, 't1', 'instruction.md'), 'utf8').trim()).toBe('Review the uncommitted change in this repo before I merge it.');
    expect(fs.readFileSync(join(dir, 't2', 'instruction.md'), 'utf8').trim()).toBe('The test suite fails. Find out why.');
    expect(fs.readFileSync(join(dir, 't3', 'instruction.md'), 'utf8').trim()).toBe('Write a two-line poem about the sea.');
    expect(spawnSync('git', ['-C', join(dir, 't1', 'workspace'), 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim()).not.toBe('');
    expect(spawnSync('git', ['-C', join(dir, 't2', 'workspace'), 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim()).toBe('');
    expect(fs.existsSync(join(dir, 't3', 'workspace'))).toBe(false);
  });
  test('fake-anthropic.ts answers one turn and logs the request for system-prompt.py', async () => {
    const dir = tmp();
    const log = join(dir, 'requests.ndjson');
    const { spawn } = require('node:child_process');
    const child = spawn('bun', [join(ROOT, 'scripts', 'gsta-135', 'fake-anthropic.ts'), '--host', '127.0.0.1', '--port', '0', '--log', log], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const url: string = await new Promise((resolve, reject) => {
        let buf = '';
        child.stdout.on('data', (d: Buffer) => { buf += d.toString(); const m = buf.match(/listening on (http:\/\/[^ ]+)/); if (m) resolve(m[1]); });
        child.on('exit', (c: number) => reject(new Error('fake endpoint exited ' + c)));
        setTimeout(() => reject(new Error('fake endpoint did not start: ' + buf)), 10000);
      });
      const res = await fetch(url + '/anthropic/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'trial-token:probe' }, body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 128000, system: 'You are OpenClaw. <skill>\n<name>gstack</name>\n<location>~/openclaw/skills/gstack/SKILL.md</location></skill>', messages: [{ role: 'user', content: 'Say ok.' }] }) });
      expect(res.status).toBe(200);
      expect((await res.json() as any).role).toBe('assistant');
      const py = spawnSync('python3', [join(ROOT, 'scripts', 'gsta-135', 'system-prompt.py'), log, 'openclaw'], { encoding: 'utf8' });
      expect(py.status).toBe(0);
      expect(py.stdout).toContain('message_requests=1');
      expect(py.stdout).toContain('model=claude-opus-5-5');
      expect(py.stdout).toContain('max_tokens=128000');
      expect(py.stdout).toContain('openclaw_gstack_skill_locations=~/openclaw/skills/gstack/SKILL.md');
    } finally { child.kill(); }
  });
});

