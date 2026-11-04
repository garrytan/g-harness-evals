// internal-task overlay: the evidence extractor on fixture transcripts, the
// wrappers' budget arithmetic and the report (the discovery table and the
// panel's Wilson intervals, bars and termination classes). Keyless; no docker.
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classify, extract, helperRun } from '../scripts/gsta-135/evidence.ts';
import { allowAtMost, bars, cells, eligible, needAtLeast, terminationClass, wilson } from '../scripts/gsta-135/report.ts';
const PANEL = 'GS' + 'TA-135';

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
    const other = { at: '2026-10-28T00:00:00.000Z', key: 'trial-token:other', outcome: 'forwarded', status: 200, reserved_usd: 1, actual_usd: 0.5 };
    writeFileSync(join(dir, 'u.ndjson'), JSON.stringify(other) + '\n');
    const expr = require('node:fs').readFileSync(join(ROOT, 'scripts', 'gsta-135', 'discovery.sh'), 'utf8').match(/spend=\$\(bun scripts\/gsta-135\/lease\.ts spend[\s\S]*?\n\s*\|\| die 2 "[^"]*"/)![0];
    const run = (usage: string) => spawnSync('bash', ['-c', `set -euo pipefail; cd "${ROOT}"; die() { echo "$2" >&2; exit "$1"; }; trial=t1; lease_id=run.t1; usage="${usage}"; ledger="${join(dir, 'none.sqlite')}"; ${expr}; echo "$spend"`], { encoding: 'utf8' });
    const zero = { forwarded: 0, spent: 0, unknown: 0, charged_reservations: 0, charged_reservation_usd: 0, provider_errors: 0, refused: 0, budget_refusals: 0, concurrent_refusals: 0, refusals: {} };
    const r = run(join(dir, 'u.ndjson'));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual(zero);
    const absent = run(join(dir, 'never-written.ndjson'));
    expect(absent.status).toBe(0);
    expect(JSON.parse(absent.stdout.trim())).toEqual(zero);
    // A reservation the proxy charged in full for an upstream failure is split out of the settled spend; a malformed line is the one abort.
    writeFileSync(join(dir, 'u.ndjson'), [other, { ...other, key: 'trial-token:t1', actual_usd: 0.3, charged_reservation: false }, { ...other, key: 'trial-token:t1', status: 529, actual_usd: 1, charged_reservation: true }].map(l => JSON.stringify(l)).join('\n') + '\n');
    expect(JSON.parse(run(join(dir, 'u.ndjson')).stdout.trim())).toEqual({ ...zero, forwarded: 2, spent: 0.3, charged_reservations: 1, charged_reservation_usd: 1 });
    writeFileSync(join(dir, 'u.ndjson'), '{"key":"trial-token:t1"\n');
    const bad = run(join(dir, 'u.ndjson'));
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('no zero row is written');
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
    expect(md).toContain('# ' + PANEL + ' live discovery, uncounted diagnostic (2026-10-28)');
    expect(md).toContain('4 forwarded, 3 refused (1 by the lease; 2 x 403 route GET /anthropic/v1/models is not allowlisted; 1 x 402 run x is over its $10 budget; a refusal costs nothing); 1 still in flight when their trial was finalized (cost in the ledger, not in any row); finalize failed for b');
    expect(md).toContain('- 2026-10-28: the lease ran with an output cap of 128,000 tokens');
    expect(md).toContain('1 planned cell(s) not dispatched after the lease refused a request (lease refusal during b)');
    expect(md).toContain('- 2026-10-28: the tree carried uncommitted changes');
    expect(md).toMatch(/\| a \| openclaw .* skill opened; helper run unobservable \(transcript truncated\) \|/);
    expect(md).toMatch(/\| b \| hermes .* no gstack skill opened in this trial \|/);
    expect(md).toMatch(/\| c \| openclaw .* not_run:cap \|/);
  });
});

describe('panel report', () => {
  test('Wilson 95% intervals at n=5 against known values', () => {
    const r3 = (w: { lo: number; hi: number }) => [Number(w.lo.toFixed(3)), Number(w.hi.toFixed(3))];
    expect(r3(wilson(0, 5))).toEqual([0, 0.434]);
    expect(r3(wilson(1, 5))).toEqual([0.036, 0.624]);
    expect(r3(wilson(3, 5))).toEqual([0.231, 0.882]);
    expect(r3(wilson(5, 5))).toEqual([0.566, 1]);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 0 });
  });
  test('every termination has a class, with the evaluator bucket kept narrow', () => {
    const classes: Record<string, string> = {};
    for (const t of ['completed', 'timeout', 'ceiling:lease', 'model_error', 'harness_error', 'infra:runtime', 'infra_error', 'infra:reservation_refused', 'infra:cap_refused', 'infra:no_model_request(harness_error)', 'not_run:panel_cap', 'not_run:not_selected', 'not_run:dry_run', 'something_else']) classes[t] = terminationClass(t);
    expect(classes).toEqual({
      completed: "the trial's own outcome", timeout: "the trial's own outcome", 'ceiling:lease': "the trial's own outcome",
      model_error: 'harness or gstack runtime', harness_error: 'harness or gstack runtime', 'infra:runtime': 'harness or gstack runtime',
      infra_error: 'evaluator infrastructure', 'infra:reservation_refused': 'evaluator infrastructure', 'infra:cap_refused': 'evaluator infrastructure', 'infra:no_model_request(harness_error)': 'evaluator infrastructure',
      'not_run:panel_cap': 'evaluator infrastructure', 'not_run:not_selected': 'evaluator infrastructure', 'not_run:dry_run': 'evaluator infrastructure', something_else: 'unclassified',
    });
  });

  // A 60-trial panel with one row of every termination; the denominators stay at the planned 5 whatever happened to the trial.
  const order: any[] = [];
  for (let i = 1; i <= 5; i++) for (const h of ['openclaw', 'hermes']) for (const t of [1, 2, 3]) for (const arm of ['baseline', 'candidate']) order.push({ order: order.length + 1, trial_id: 'p1.' + h + '-t' + t + '-' + arm + '-' + i, harness: h, task: t, arm, trial_index: i, time_budget_s: 600 });
  const manifest = { run_id: 'gsta-135-panel-test', created_at: '2026-10-29T10:00:00Z', tree: 'abc', hermes_mode: 'chat', max_tokens: 128000, per_trial_usd: 1, r_max_usd: 3.12, lease_usd: 4.12, panel_cap_usd: 15,
    arms: { baseline: { gstack_sha: 'aaaa1111', images: { openclaw: { tag: 'harness-eval/openclaw:gstack-aaaa1111', digest: 'sha256:1111' }, hermes: { tag: 'harness-eval/hermes:gstack-aaaa1111-chat', digest: 'sha256:2222' } } }, candidate: { gstack_sha: 'bbbb2222', images: { openclaw: { tag: 'harness-eval/openclaw:gstack-bbbb2222', digest: 'sha256:3333' }, hermes: { tag: 'harness-eval/hermes:gstack-bbbb2222-chat', digest: 'sha256:4444' } } } },
    stop_rule: 'settled + unknown + lease_usd <= cap before each lease', marker: { line: 'harnesses/_gstack/wrapper-lib.sh:40', variables: ['GSTACK_SESSION_KIND', 'GSTACK_STATE_ROOT'] }, approval: { setting: 'approvals.single_query_mode', value: 'deny' },
    order, ceilings: { task1: 0.4, task2: 0.4, task3: 0.15 }, bars: PANEL + ' bars text.' };
  const m = (opened: number, started: number, success: boolean | null, control: number | null = null, attempted = started) => ({ matching_skill_opened: opened, matching_skill_started: started, started_attempted: attempted, control_false_open: control, task_success: success, skills_opened: opened ? ['gstack-review'] : [], other_skills_opened: [] });
  const complete = (metrics: unknown) => ({ transcript: 'complete', tool_calls: 3, gstack_paths: 0, termination_hint: null, metrics });
  function panelRows(candidate: (h: string, t: number, i: number) => ReturnType<typeof m>) {
    const special: Record<string, any> = {
      'p1.openclaw-t2-baseline-2': { termination: 'timeout', exit_code: 124, evidence: { ...complete(m(0, 0, null)), transcript: 'truncated' } },
      'p1.openclaw-t2-candidate-2': { termination: 'model_error', exit_code: 3, evidence: null },
      'p1.hermes-t1-baseline-3': { termination: 'harness_error', exit_code: 2, evidence: null },
      'p1.hermes-t1-candidate-3': { termination: 'infra_error', exit_code: 1, evidence: null },
      'p1.hermes-t2-baseline-3': { termination: 'ceiling:lease', usd_spent: 1.05, requests_refused: 1, budget_refusals: 1, refusals: { '402 run p1 is over its $4.12 budget': 1 }, evidence: { ...complete(m(0, 0, null)), transcript: 'truncated' } },
      'p1.hermes-t2-candidate-3': { termination: 'infra:reservation_refused', requests_forwarded: 0, usd_spent: 0, requests_refused: 1, budget_refusals: 1, refusals: { '402 reservation': 1 }, evidence: null },
      'p1.openclaw-t3-baseline-4': { termination: 'infra:cap_refused', requests_forwarded: 0, usd_spent: 0, requests_refused: 1, refusals: { '400 max_tokens above the cap': 1 }, evidence: null },
      'p1.openclaw-t3-candidate-4': { termination: 'infra:no_model_request(harness_error)', requests_forwarded: 0, usd_spent: 0, evidence: null },
      'p1.hermes-t3-baseline-4': { termination: 'infra:runtime', requests_forwarded: 0, usd_spent: 0, evidence: null },
      'p1.hermes-t3-candidate-4': { termination: 'completed', termination_hint: 'length', evidence: { ...complete(m(0, 0, null, 0)), transcript: 'truncated', termination_hint: 'length' } },
      'p1.openclaw-t1-baseline-5': { termination: 'not_run:panel_cap', requests_forwarded: 0, usd_spent: 0, exit_code: null, evidence: null },
      'p1.openclaw-t1-candidate-5': { termination: 'not_run:panel_cap', requests_forwarded: 0, usd_spent: 0, exit_code: null, evidence: null },
      'p1.hermes-t1-baseline-5': { termination: 'not_run:not_selected', requests_forwarded: 0, usd_spent: 0, exit_code: null, evidence: null },
      'p1.hermes-t1-candidate-5': { termination: 'not_run:dry_run', requests_forwarded: 0, usd_spent: 0, exit_code: null, evidence: null },
    };
    return order.map(od => {
      const base = { ...od, image: 'i', image_digest: 'd', tree: 'abc', tree_dirty: false, model: 'claude-opus-5-5', workspace_seen: true, started_at: '2026-10-29T10:00:00Z', exit_code: 0, wall_ms: 1000, requests_forwarded: 4, requests_refused: 0, budget_refusals: 0, refusals: {}, requests_undrained: 0, usd_spent: 0.1 + od.trial_index * 0.01, usd_reserved_unknown: 0, lease_usd: 4.12, grade: 'pass', max_tokens: 128000, termination: 'completed', note: '' };
      const metrics = od.task === 3 ? m(0, 0, null, 0) : od.arm === 'candidate' ? candidate(od.harness, od.task, od.trial_index) : m(od.harness === 'openclaw' && od.trial_index === 1 ? 1 : 0, 0, true);
      return { ...base, evidence: complete(metrics), ...(special[od.trial_id] ?? {}) };
    }).filter(r => r.trial_id !== 'p1.hermes-t2-candidate-5');
  }
  function render(rows: any[], stop: string | null = null) {
    const dir = tmp();
    const fs = require('node:fs');
    fs.writeFileSync(join(dir, 'cells.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const text = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(join(dir, 'manifest.json'), text);
    fs.writeFileSync(join(dir, 'manifest.sha256'), require('node:crypto').createHash('sha256').update(text).digest('hex') + '  manifest.json\n');
    const r = spawnSync('bun', [join(ROOT, 'scripts', 'gsta-135', 'report.ts'), join(dir, 'cells.jsonl'), join(dir, 'report.md'), '--manifest', join(dir, 'manifest.json'), ...(stop ? ['--stop', stop] : [])], { encoding: 'utf8' });
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    return fs.readFileSync(join(dir, 'report.md'), 'utf8') as string;
  }
  test('a three-arm manifest (internal-task) lists the none arm first and says three arms', () => {
    const two = (manifest as any).arms;
    (manifest as any).arms = { none: { gstack_sha: 'none', images: { openclaw: { tag: 'harness-eval/openclaw:gstack-none', digest: 'sha256:3333' } } }, ...two };
    try {
      const md = render(panelRows((h, t, i) => m(1, 1, true, null, 1)));
      expect(md).toContain('Three arms: no gstack (none), and two that differ only by the gstack pin (baseline: main at freeze; candidate: ' + PANEL + ')');
      expect(md).toContain('- none: gstack none; images openclaw harness-eval/openclaw:gstack-none (sha256:3333)\n- baseline: gstack aaaa1111; ');
    } finally { (manifest as any).arms = two; }
    expect(render(panelRows((h, t, i) => m(1, 1, true, null, 1)))).toContain('Two arms that differ only by the gstack pin');
  });
  test('counts over the planned n, bars per harness, the inconclusive wording, every termination classed, deviations', () => {
    const rows = panelRows((h, t, i) => h === 'openclaw' ? m(1, t === 1 && i === 4 ? 0 : 1, true, null, 1) : m(i <= 3 ? 1 : 0, i <= 2 ? 1 : 0, true, null, i <= 3 ? 1 : 0));
    const md = render(rows, 'panel cap reached before order 57');
    expect(md).toContain('# ' + PANEL + ' skill-use panel gsta-135-panel-test (2026-10-29)');
    expect(md).toContain('- baseline: gstack aaaa1111; images openclaw harness-eval/openclaw:gstack-aaaa1111 (sha256:1111), hermes harness-eval/hermes:gstack-aaaa1111-chat (sha256:2222)');
    expect(md).toContain('- lease per trial $4.1200 = per-trial bar $1.0000 + R_max $3.1200; panel cap $15.0000; stop rule: settled + unknown + lease_usd <= cap before each lease');
    expect(md).toContain('- test-run marker: harnesses/_gstack/wrapper-lib.sh:40 (GSTACK_SESSION_KIND, GSTACK_STATE_ROOT); approval: approvals.single_query_mode=deny');
    expect(md).toMatch(/- manifest sha256 [0-9a-f]{64} \(matches manifest.sha256\)/);
    expect(md).toContain('Hermes rows are chat-mode under the overlay adapter');
    expect(md).toContain(PANEL + ' bars text.');
    expect(md).toContain("**openclaw: meets the bars; improvement inconclusive at n=5 (the arms' intervals overlap)**");
    expect(md).toContain('- met: task 1 opens the matching skill in at least 0.6 of the planned n and strictly above baseline: candidate 4 of 5 (at least 3 of 5 at n=5; Wilson 0.38 to 0.96), baseline 1/5 (0.04 to 0.62)');
    expect(md).toContain('- met: task 1 starts the matching skill (helper exit 0) in at least 0.6 of the planned n: candidate 3 of 5 (at least 3 of 5 at n=5; Wilson 0.23 to 0.88) (4 attempted), baseline 0/5 (0.00 to 0.43)');
    expect(md).toContain('- met: task 3 control opens a skill in at most 0.2 of the planned n: candidate 0 of 5 (at most 1 of 5 at n=5; Wilson 0.00 to 0.43), baseline 0/5 (0.00 to 0.43)');
    expect(md).toContain('**hermes: does not meet the bars (6 of 11 not met)**');
    expect(md).toContain('- not met: task 1 opens the matching skill in at least 0.6 of the planned n and strictly above baseline: candidate 2 of 5 (at least 3 of 5 at n=5; Wilson 0.12 to 0.77), baseline 0/5 (0.00 to 0.43)');
    expect(md).toContain('- not met: every run trial under $1.00: 26 of 27 (over: p1.hermes-t2-baseline-3 $1.0500, lease refusal)');
    expect(md).toContain('- met: every run trial under $1.00: 28 of 28');
    expect(md).toContain('- met: task 3 candidate median cost under the ceiling: median $0.1300 against $0.1500 over 5 run trial(s)');
    expect(md).toContain('| openclaw | 1 | baseline | 5 | 4 | 4 | 1/5 (0.04 to 0.62) | 0/5 (0.00 to 0.43) (0) | n/a | 4/5 (0.38 to 0.96) | $0.1250 | $0.1400 | $0.4000 | 4 | 1/0/0/4 |');
    expect(md).toContain('| hermes | 2 | candidate | 5 | 4 | 3 | 2/5 (0.12 to 0.77) | 2/5 (0.12 to 0.77) (2) | n/a | 3/5 (0.23 to 0.88) | $0.1150 | $0.1400 | $0.4000 | 3 | 2/2/0/3 |');
    expect(md).toContain('| hermes | 3 | candidate | 5 | 5 | 4 | n/a | n/a | 0/5 (0.00 to 0.43) | n/a | $0.1300 | $0.1500 | $0.1500 | 4 | 0/0/0/0 |');
    expect(md).toContain('Eligibility comes before every count');
    expect(md).toMatch(/\| 33 \| p1.hermes-t2-baseline-3 \| hermes \| 2 \| baseline \| ceiling:lease \| the trial's own outcome \| 0 \| 4 \| \$1.0500 \| \$0.0000 \| \$4.1200 \| no \|/);
    expect(md).toMatch(/\| 48 \| p1.hermes-t3-candidate-4 .* \| truncated \| length \|/);
    expect(md).toMatch(/\| 49 \| p1.openclaw-t1-baseline-5 .* not_run:panel_cap \| evaluator infrastructure \| {2}\| 0 \| \$0.0000 \| \$0.0000 \| \$4.1200 \| not run \|/);
    for (const [t, c, n] of [['ceiling:lease', "the trial's own outcome", 1], ['completed', "the trial's own outcome", 46], ['harness_error', 'harness or gstack runtime', 1], ['infra:cap_refused', 'evaluator infrastructure', 1], ['infra:no_model_request(harness_error)', 'evaluator infrastructure', 1], ['infra:reservation_refused', 'evaluator infrastructure', 1], ['infra:runtime', 'harness or gstack runtime', 1], ['infra_error', 'evaluator infrastructure', 1], ['model_error', 'harness or gstack runtime', 1], ['not_run:dry_run', 'evaluator infrastructure', 1], ['not_run:not_selected', 'evaluator infrastructure', 1], ['not_run:panel_cap', 'evaluator infrastructure', 2], ['timeout', "the trial's own outcome", 1]]) {
      expect(md).toContain('| ' + t + ' | ' + c + ' | ' + n + ' | ');
    }
    expect(md).toContain('- 2026-10-29: stopped: panel cap reached before order 57.');
    expect(md).toContain('- 2026-10-29: 4 planned trial(s) not run (not_run:panel_cap, not_run:not_selected, not_run:dry_run): p1.openclaw-t1-baseline-5, p1.openclaw-t1-candidate-5, p1.hermes-t1-baseline-5, p1.hermes-t1-candidate-5. They stay in every denominator as absences; nothing was replaced.');
    expect(md).toContain('- 2026-10-29: 1 trial(s) in the manifest order have no row in cells.jsonl: p1.hermes-t2-candidate-5. They stay in every denominator as absences.');
    expect(md).toContain('- 2026-10-29: 1 trial(s) ended on a length stop under the max_tokens pin (128000): p1.hermes-t3-candidate-4. Paid but unobservable; counted as absences.');
    expect(md).toContain('- 2026-10-29: p1.hermes-t3-baseline-4: the runtime preflight failed or the wrapper logged a degraded start');
    expect(md).not.toMatch(/\brank|composite/i);
  });
  test('eligibility before counting: an ineligible row of every kind is an absence in every numerator, stays in planned and shows in observed', () => {
    const full = m(1, 1, true, 1, 1);
    const ineligible = [
      { termination: 'infra:runtime', evidence: complete(full) },
      { termination: 'infra:reservation_refused', evidence: complete(full) },
      { termination: 'infra:cap_refused', evidence: complete(full) },
      { termination: 'infra_error', evidence: complete(full) },
      { termination: 'not_run:panel_cap', evidence: complete(full) },
      { termination: 'completed', evidence: { ...complete(full), transcript: 'truncated' } },
      { termination: 'completed', evidence: { ...complete(full), transcript: 'tampered' } },
      { termination: 'completed', termination_hint: 'length', evidence: complete(full) },
      { termination: 'completed', evidence: { ...complete(full), termination_hint: 'length' } },
      { termination: 'timeout', evidence: { ...complete(full), transcript: 'truncated' } },
    ];
    for (const r of ineligible) expect([r, eligible(r)]).toEqual([r, false]);
    expect(eligible({ termination: 'completed', evidence: complete(full) })).toBe(true);
    expect(eligible({ termination: 'timeout', evidence: complete(full) })).toBe(true);
    expect(eligible({ termination: 'ceiling:lease', evidence: complete(full) })).toBe(true);
    const o = ineligible.map((_, i) => ({ trial_id: 't' + i, harness: 'openclaw', task: 1, arm: 'candidate' })).concat([{ trial_id: 'ok', harness: 'openclaw', task: 1, arm: 'candidate' }, { trial_id: 'c3', harness: 'openclaw', task: 3, arm: 'candidate' }]);
    const rows = [...ineligible.map((r, i) => ({ ...o[i], usd_spent: 0.1, ...r })), { ...o[o.length - 2], termination: 'completed', usd_spent: 0.1, evidence: complete(full) }, { ...o[o.length - 1], termination: 'infra:runtime', usd_spent: 0.05, evidence: complete(m(0, 0, null, 1)) }];
    const c = cells(rows, o).find(c => c.task === 1)!;
    expect(c).toMatchObject({ planned: 11, observable: 8, eligible: 1, opened: 1, started: 1, attempted: 1, control: 10, success: 1, observed: { opened: 11, started: 11, attempted: 11, control: 11, success: 11 } });
    expect(c.run.length).toBe(10);
    expect(cells(rows, o).find(c => c.task === 3)).toMatchObject({ planned: 1, eligible: 0, control: 1, observed: { control: 1 } });
    const t3 = (transcript: string, termination = 'completed') => ({ trial_id: 'x', harness: 'openclaw', task: 3, arm: 'candidate', termination, usd_spent: 0.01, evidence: { ...complete(m(0, 0, null, 1)), transcript } });
    expect(cells([t3('truncated', 'timeout'), t3('complete')], null).find(c => c.task === 3)).toMatchObject({ planned: 2, eligible: 1, control: 2 });
    const md = render(rows.map(r => ({ ...r, order: 1, requests_forwarded: 1 })));
    expect(md).toContain('| openclaw | 1 | candidate | 11 | 10 | 8 | 1/11 (0.02 to 0.38) | 1/11 (0.02 to 0.38) (1) | n/a | 1/11 (0.02 to 0.38) | $0.1000 | $0.1000 | $0.4000 | 1 | 11/11/11/11 |');
    expect(md).toContain('an absence in every numerator but the control ceiling whatever the transcript shows; its events are in the observed column');
    const charged = render(rows.map((r, i) => ({ ...r, order: 1, requests_forwarded: 1, usd_charged_reservation: i === 0 ? 5.56 : 0 })));
    expect(charged).toContain('settled; $5.5600 charged at full reservation on upstream failures');
  });
  test('the bars are proportions of the planned n and keep their meaning at n=5 and n=10', () => {
    expect([5, 10, 1, 2].map(needAtLeast)).toEqual([3, 6, 1, 2]);
    expect([5, 10, 4, 15].map(allowAtMost)).toEqual([1, 2, 0, 3]);
    const panel = (n: number, opened: number, control: number) => {
      const o: any[] = [], rows: any[] = [];
      for (let i = 1; i <= n; i++) for (const task of [1, 2, 3]) for (const arm of ['baseline', 'candidate']) {
        const od = { trial_id: 'x-' + task + '-' + arm + '-' + i, harness: 'openclaw', task, arm };
        o.push(od);
        const metrics = task === 3 ? m(0, 0, null, arm === 'candidate' && i <= control ? 1 : 0) : arm === 'candidate' && i <= opened ? m(1, 1, true, null, 1) : m(0, 0, true, null, 0);
        rows.push({ ...od, termination: 'completed', usd_spent: 0.1, evidence: complete(metrics) });
      }
      return bars(cells(rows, o), 'openclaw', 1, { task1: 0.4, task2: 0.4, task3: 0.15 }, n);
    };
    expect(panel(5, 3, 1).lines[0]).toBe('- met: task 1 opens the matching skill in at least 0.6 of the planned n and strictly above baseline: candidate 3 of 5 (at least 3 of 5 at n=5; Wilson 0.23 to 0.88), baseline 0/5 (0.00 to 0.43)');
    expect(panel(5, 3, 1).lines.filter(l => l.startsWith('- not met'))).toEqual([]);
    expect(panel(5, 2, 1).lines[0]).toStartWith('- not met: task 1 opens');
    expect(panel(5, 3, 2).lines[6]).toBe('- not met: task 3 control opens a skill in at most 0.2 of the planned n: candidate 2 of 5 (at most 1 of 5 at n=5; Wilson 0.12 to 0.77), baseline 0/5 (0.00 to 0.43)');
    expect(panel(10, 6, 2).lines[0]).toBe('- met: task 1 opens the matching skill in at least 0.6 of the planned n and strictly above baseline: candidate 6 of 10 (at least 6 of 10 at n=10; Wilson 0.31 to 0.83), baseline 0/10 (0.00 to 0.28)');
    expect(panel(10, 6, 2).lines[1]).toBe('- met: task 1 starts the matching skill (helper exit 0) in at least 0.6 of the planned n: candidate 6 of 10 (at least 6 of 10 at n=10; Wilson 0.31 to 0.83) (6 attempted), baseline 0/10 (0.00 to 0.28)');
    expect(panel(10, 6, 2).lines.filter(l => l.startsWith('- not met'))).toEqual([]);
    expect(panel(10, 6, 2).verdict).toBe("openclaw: meets the bars; the arms' intervals are separated at n=10 on every bar");
    expect(panel(10, 5, 2).lines[0]).toStartWith('- not met: task 1 opens the matching skill in at least 0.6 of the planned n and strictly above baseline: candidate 5 of 10 (at least 6 of 10 at n=10;');
    expect(panel(10, 5, 2).lines[1]).toStartWith('- not met: task 1 starts');
    expect(panel(10, 6, 3).lines[6]).toStartWith('- not met: task 3 control opens a skill in at most 0.2 of the planned n: candidate 3 of 10 (at most 2 of 10 at n=10;');
  });
  test('a tampered transcript is listed in the deviations and the trials table and earns nothing', () => {
    const rows = panelRows(() => m(1, 1, true, null, 1)).map(r => r.trial_id === 'p1.openclaw-t1-candidate-1' ? { ...r, evidence: { ...complete(m(0, 0, false, null, 0)), transcript: 'tampered' } } : r);
    const md = render(rows);
    expect(md).toContain('- 2026-10-29: p1.openclaw-t1-candidate-1: the transcript carries a user row after the first assistant row (an injected turn; a trial has one user turn). Tampered, no credit, counted as absences.');
    expect(md).toMatch(/\| 2 \| p1.openclaw-t1-candidate-1 .* \| 0 \| 0 \| false \| tampered \| {2}\|/);
    expect(md).toContain('| openclaw | 1 | candidate | 5 | 4 | 3 | 3/5 (0.23 to 0.88) | 3/5 (0.23 to 0.88) (3) | n/a | 3/5 (0.23 to 0.88) |');
    expect(md).toContain('Known false-positive forms still accepted');
  });
  test('separated intervals drop the inconclusive wording; a bar is met only on the counts', () => {
    const cs = cells(panelRows(() => m(1, 1, true, null, 1)).filter(r => r.harness === 'openclaw' && !r.termination.startsWith('not_run') && r.termination !== 'model_error'), order.filter(o => o.harness === 'openclaw'));
    expect(cs.find(c => c.task === 1 && c.arm === 'candidate')).toMatchObject({ planned: 5, opened: 4, started: 4, success: 4 });
    const b = bars(cs, 'openclaw', 1, { task1: 0.4, task2: 0.4, task3: 0.15 });
    expect(b.verdict).toBe('openclaw: meets the bars; improvement inconclusive at n=5 (the arms\' intervals overlap)');
    const full = cells(panelRows(() => m(1, 1, true, null, 1)).filter(r => r.harness === 'openclaw').map(r => ({ ...r, termination: 'completed', evidence: complete(r.arm === 'candidate' && r.task !== 3 ? m(1, 1, true, null, 1) : m(0, 0, true, r.task === 3 ? 0 : null)) })), order.filter(o => o.harness === 'openclaw'));
    const sep = bars(full, 'openclaw', 1, { task1: 0.4, task2: 0.4, task3: 0.15 });
    expect(sep.verdict).toBe("openclaw: meets the bars; the arms' intervals are separated at n=5 on every bar");
    expect(sep.lines.filter(l => l.startsWith('- not met'))).toEqual([]);
    expect(bars(full, 'hermes', 1, { task1: 0.4, task2: 0.4, task3: 0.15 }).verdict).toBe('hermes: not measured (no run trial)');
    const noCeiling = bars(full, 'openclaw', 1, { task1: null, task2: 0.4, task3: 0.15 });
    expect(noCeiling.lines).toContain('- not met: task 1 candidate median cost under the ceiling: median $0.1200 against no ceiling over 5 run trial(s)');
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

