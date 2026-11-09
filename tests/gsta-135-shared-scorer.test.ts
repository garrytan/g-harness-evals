// internal-task-a's shared-scorer changes to internal-task-b's internal-task-c files, each checked to
// be backward-compatible: lease.ts's three-arm order (the two-arm default
// pinned byte for byte), fake-anthropic.ts's raw_tool turn, evidence.ts's
// exported readers and opt-in raw fields, discovery.sh's three-arm panel
// (dry runs, labels and the same-SHA refusal, with a stubbed docker), and the
// GSTACK_COMMIT=none overlay (the wrappers run with no /opt/gstack, no docker).
// tests/gsta-135-golden.test.ts re-scores both published panels. Keyless:
// every spawned process gets a scrubbed environment with no key variable.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { PANEL_ARMS, PANEL_ARMS_WITH_NONE, panelOrder } from '../scripts/gsta-135/lease.ts';
import { play, startFakeAnthropic, validateScript, type Turn } from '../scripts/gsta-135/fake-anthropic.ts';
import { extract, readers, score } from '../scripts/gsta-135/evidence.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'harn18-shared-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const rows = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
/** The environment every spawned process gets: PATH and HOME, never a key. */
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? tmp };

describe('lease.ts panel order', () => {
  test('the two-arm default is internal-task-a\'s order byte for byte (sha256 pinned from the pre-internal-task-b code), with or without the explicit arm list', () => {
    expect(sha256(JSON.stringify(panelOrder(5)))).toBe('eafe2d1281fc3b5bd34c1e19ac709ed46826f77fb8f83386f050cebabc9bfdca');
    expect(sha256(JSON.stringify(panelOrder(8)))).toBe('a52b5e7e4c927fb4d4d703311632eff74aea03c96168f9e6330cdaa4741497ab');
    expect(JSON.stringify(panelOrder(8, PANEL_ARMS))).toBe(JSON.stringify(panelOrder(8)));
    expect(JSON.stringify(panelOrder(8, ['baseline', 'candidate']))).toBe(JSON.stringify(panelOrder(8)));
    expect(panelOrder(8)).toHaveLength(96);
    expect(spawnSync('bun', ['scripts/gsta-135/lease.ts', 'order', '--trials', '8'], { cwd: ROOT, env: ENV, encoding: 'utf8' }).stdout).toBe(JSON.stringify(panelOrder(8)) + '\n');
  });
  test('the three-arm order puts none first in each cell, keeps the gstack arms\' ids and relative order, and names none trials with arm none', () => {
    const three = panelOrder(8, PANEL_ARMS_WITH_NONE);
    expect(three).toHaveLength(144);
    expect(three.map(r => r.order)).toEqual(Array.from({ length: 144 }, (_, i) => i + 1));
    expect(new Set(three.map(r => r.trial_id)).size).toBe(144);
    expect(three.slice(0, 6).map(r => r.trial_id)).toEqual(['gsta135-openclaw-t1-none-1', 'gsta135-openclaw-t1-baseline-1', 'gsta135-openclaw-t1-candidate-1', 'gsta135-hermes-t1-none-1', 'gsta135-hermes-t1-baseline-1', 'gsta135-hermes-t1-candidate-1']);
    expect(three[143]).toMatchObject({ trial_id: 'gsta135-hermes-t3-candidate-8', arm: 'candidate', trial_index: 8, task: 3, time_budget_s: 120 });
    const none = three.filter(r => r.arm === 'none');
    expect(none).toHaveLength(48);
    for (const r of none) expect(r.trial_id).toBe('gsta135-' + r.harness + '-t' + r.task + '-none-' + r.trial_index);
    const gstack = three.filter(r => r.arm !== 'none').map(({ order, ...rest }) => rest);
    expect(gstack).toEqual(panelOrder(8).map(({ order, ...rest }) => rest));
    expect(JSON.parse(spawnSync('bun', ['scripts/gsta-135/lease.ts', 'order', '--trials', '8', '--arms', 'none,baseline,candidate'], { cwd: ROOT, env: ENV, encoding: 'utf8' }).stdout)).toEqual(three);
  });
  test('any other arm list is refused', () => {
    for (const arms of [['none', 'candidate'], ['candidate', 'baseline'], ['baseline', 'candidate', 'none'], [], ['none', 'none', 'baseline', 'candidate']]) expect(() => panelOrder(2, arms)).toThrow('--arms must be');
    const r = spawnSync('bun', ['scripts/gsta-135/lease.ts', 'order', '--trials', '2', '--arms', 'none,candidate'], { cwd: ROOT, env: ENV, encoding: 'utf8' });
    expect(r.status).toBe(64);
    expect(r.stderr).toContain('--arms must be baseline,candidate or none,baseline,candidate');
  });
});

describe('fake-anthropic.ts raw_tool turns', () => {
  const offered = [{ name: 'exec', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }];
  const agent = { model: 'claude-opus-5-5', max_tokens: 64, tools: offered, messages: [{ role: 'user', content: 'go' }] };
  test('emits a tool_use for the named tool whether or not the request offers it, input as given ({} without one), never missing', () => {
    const turns: Turn[] = [{ raw_tool: 'skills_read', input: { name: 'gstack' } }, { raw_tool: 'exec' }, { raw_tool: 'exec', input: { cmd: 1 } }];
    const a = play(agent, turns, 0);
    expect(a).toMatchObject({ status: 200, stop_reason: 'tool_use', missing: false, content: [{ type: 'tool_use', id: 'toolu_fake_1', name: 'skills_read', input: { name: 'gstack' } }] });
    expect(play(agent, turns, 1).content).toEqual([{ type: 'tool_use', id: 'toolu_fake_2', name: 'exec', input: {} }]);
    expect(play(agent, turns, 2).content).toEqual([{ type: 'tool_use', id: 'toolu_fake_3', name: 'exec', input: { cmd: 1 } }]);
    expect(play({ ...agent, tools: [] }, turns, 0)).toMatchObject({ turn: null, content: [{ type: 'text', text: 'ok' }] });
    expect(play({ ...agent, messages: [] }, [{ raw_tool: 'x', match: { min_messages: 1 } }], 0).turn).toBeNull();
  });
  test('the existing turns play as before', () => {
    expect(play(agent, [{ tool: 'ls' }], 0).content).toEqual([{ type: 'tool_use', id: 'toolu_fake_1', name: 'exec', input: { command: 'ls' } }]);
    expect(play(agent, [{ call: 'skills_read' }], 0)).toMatchObject({ missing: true, content: [{ type: 'text', text: 'fake: tool skills_read not offered' }] });
    expect(play(agent, [{ call: 'exec' }], 0).content).toEqual([{ type: 'tool_use', id: 'toolu_fake_1', name: 'exec', input: { command: 'x' } }]);
  });
  test('validateScript accepts a raw_tool turn and refuses a malformed one', () => {
    const turns = [{ raw_tool: 'skills_read', input: { name: 'gstack' } }, { raw_tool: 'nope' }];
    expect(validateScript(turns)).toEqual(turns as Turn[]);
    for (const bad of [[{ raw_tool: 3 }], [{ raw_tool: '' }], [{ raw_tool: 'x', input: [] }], [{ raw_tool: 'x', input: 'y' }], [{ raw_tool: 'x', input: null }]]) expect(() => validateScript(bad)).toThrow('--script must be');
  });
  test('served streamed and as JSON, logged as played', async () => {
    const log = join(tmp, 'raw-tool.ndjson');
    const fake = startFakeAnthropic({ log, script: [{ raw_tool: 'skills_read', input: { name: 'gstack' } }, { raw_tool: 'phantom' }] });
    try {
      const post = (body: unknown) => fetch(fake.url + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'trial-token:placeholder' }, body: JSON.stringify(body) });
      const json = await (await post(agent)).json() as any;
      expect(json.content).toEqual([{ type: 'tool_use', id: 'toolu_fake_1', name: 'skills_read', input: { name: 'gstack' } }]);
      const sse = await (await post({ ...agent, stream: true })).text();
      expect(sse).toContain('"content_block":{"type":"tool_use","id":"toolu_fake_2","name":"phantom","input":{}}');
      expect(sse).toContain('"partial_json":"{}"');
      expect(rows(log).map(r => r.played)).toEqual([{ raw_tool: 'skills_read', input: { name: 'gstack' } }, { raw_tool: 'phantom' }]);
    } finally { fake.stop(); }
  });
});

describe('evidence.ts exports and raw fields', () => {
  const FIX = join(ROOT, 'tests', 'fixtures', 'gsta-135');
  const trials = readdirSync(FIX).filter(d => d.startsWith('gsta135-')).sort();
  const RAW_KEYS = ['raw_args', 'result_text', 'error_text'];
  test('on the 12 captured stores the default output carries no raw field, readers + score() is extract(), and raw adds only the three fields to each event (skill_open, sub_skill_open and helper_run are events too)', () => {
    let events = 0, withText = 0;
    for (const t of trials) {
      const known = JSON.parse(readFileSync(join(FIX, t, 'known.json'), 'utf8'));
      const dir = join(FIX, t);
      const def = extract(known.harness, dir, known.task);
      for (const e of def.events) for (const k of RAW_KEYS) expect(k in e).toBe(false);
      expect(JSON.stringify(score(readers[known.harness as 'openclaw' | 'hermes'](dir, known.task), known.task))).toBe(JSON.stringify(def));
      const raw = extract(known.harness, dir, known.task, { raw: true });
      const strip = (e: any) => e === null ? null : Object.fromEntries(Object.entries(e).filter(([k]) => !RAW_KEYS.includes(k)));
      const stripped = { ...raw, events: raw.events.map(strip), skill_open: strip(raw.skill_open), sub_skill_open: strip(raw.sub_skill_open), helper_run: strip(raw.helper_run) };
      expect(JSON.stringify(stripped)).toBe(JSON.stringify(def));
      const calls = readers[known.harness as 'openclaw' | 'hermes'](dir, known.task).calls;
      expect(calls).toHaveLength(def.tool_calls);
      for (const e of raw.events) {
        for (const k of RAW_KEYS) expect(k in e).toBe(true);
        const call = calls.find(c => c.locator === e.locator && c.tool === e.tool)!;
        expect(e.raw_args).toEqual(call.args);
        expect(e.result_text).toBe(call.result?.text ?? null);
        if (e.result === 'ok') expect(e.error_text).toBeNull();
        events++; if (e.result_text) withText++;
      }
    }
    expect(events).toBeGreaterThan(0);
    expect(withText).toBe(events);
  });
  test('raw error text: an OpenClaw error result and a Hermes error body are carried as error_text', () => {
    const { Database } = require('bun:sqlite');
    const oc = join(tmp, 'oc-raw');
    mkdirSync(join(oc, 'state', 'openclaw', 'exec', 'agents', 'main', 'agent'), { recursive: true });
    const db = new Database(join(oc, 'state', 'openclaw', 'exec', 'agents', 'main', 'agent', 'openclaw-agent.sqlite'));
    db.run('create table transcript_events (session_id text, seq integer, created_at integer, event_json text, event_zstd blob)');
    const put = (seq: number, message: unknown) => db.run('insert into transcript_events values (?, ?, ?, ?, null)', ['s1', seq, 1, JSON.stringify({ type: 'message', message })]);
    put(1, { role: 'user', content: 'Review the uncommitted change in this repo before I merge it.' });
    put(2, { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'c1', name: 'skills_read', arguments: { name: 'gstack' } }] });
    put(3, { role: 'toolResult', toolCallId: 'c1', toolName: 'skills_read', isError: true, content: [{ type: 'text', text: 'Tool skills_read not found' }] });
    put(4, { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Do not merge.' }] });
    db.close();
    const def = extract('openclaw', oc, 1);
    const raw = extract('openclaw', oc, 1, { raw: true });
    expect(def.events).toEqual([expect.objectContaining({ kind: 'skill_open', tool: 'skills_read', result: 'error' })]);
    expect('error_text' in def.events[0]).toBe(false);
    expect(raw.events[0]).toMatchObject({ raw_args: { name: 'gstack' }, result_text: 'Tool skills_read not found', error_text: 'Tool skills_read not found' });
    expect(raw.metrics).toEqual(def.metrics);
    const he = join(tmp, 'he-raw');
    mkdirSync(join(he, 'state', 'hermes'), { recursive: true });
    const hdb = new Database(join(he, 'state', 'hermes', 'state.db'));
    hdb.run('create table messages (id integer primary key, session_id text, role text, content text, tool_call_id text, tool_calls text, tool_name text, finish_reason text)');
    const row = (role: string, content: string | null, extra: { tool_call_id?: string; tool_calls?: string; tool_name?: string; finish_reason?: string } = {}) =>
      hdb.run('insert into messages (session_id, role, content, tool_call_id, tool_calls, tool_name, finish_reason) values (?, ?, ?, ?, ?, ?, ?)', ['h1', role, content, extra.tool_call_id ?? null, extra.tool_calls ?? null, extra.tool_name ?? null, extra.finish_reason ?? null]);
    row('user', 'Review the uncommitted change in this repo before I merge it.');
    row('assistant', '', { tool_calls: JSON.stringify([{ id: 't1', function: { name: 'skill_view', arguments: JSON.stringify({ name: 'gstack-review' }) } }]), finish_reason: 'tool_calls' });
    row('tool', JSON.stringify({ success: false, error: 'Skill gstack-review not found' }), { tool_call_id: 't1', tool_name: 'skill_view' });
    row('assistant', 'Do not merge.', { finish_reason: 'stop' });
    hdb.close();
    const hraw = extract('hermes', he, 1, { raw: true });
    expect(hraw.events[0]).toMatchObject({ kind: 'skill_open', result: 'error', raw_args: { name: 'gstack-review' }, error_text: 'Skill gstack-review not found' });
    expect(hraw.events[0].result_text).toBe(JSON.stringify({ success: false, error: 'Skill gstack-review not found' }));
    expect(hraw.metrics).toEqual(extract('hermes', he, 1).metrics);
  });
  test('the CLI prints raw fields only with --raw', () => {
    const t = trials.find(x => x.includes('openclaw-t1-gstack'))!;
    const known = JSON.parse(readFileSync(join(FIX, t, 'known.json'), 'utf8'));
    const cli = (...extra: string[]) => spawnSync('bun', ['scripts/gsta-135/evidence.ts', 'openclaw', join('tests/fixtures/gsta-135', t), '--task', String(known.task), ...extra], { cwd: ROOT, env: ENV, encoding: 'utf8' });
    const def = JSON.parse(cli().stdout), raw = JSON.parse(cli('--raw').stdout);
    expect(def.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(def.events)).not.toContain('"raw_args"');
    expect(raw.events.every((e: any) => 'raw_args' in e && 'result_text' in e && 'error_text' in e)).toBe(true);
    expect(raw.metrics).toEqual(def.metrics);
  });
});

describe('discovery.sh three-arm panel', () => {
  const sh = join(ROOT, 'scripts/gsta-135/discovery.sh');
  const repo = join(tmp, 'gstack');
  mkdirSync(repo);
  const g = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: ENV }).trim();
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  writeFileSync(join(repo, 'VERSION'), '1\n'); g('add', '.'); g('commit', '-qm', 'one');
  const c1 = g('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'VERSION'), '2\n'); g('add', '.'); g('commit', '-qm', 'two');
  const c2 = g('rev-parse', 'HEAD');
  const ceilings = join(tmp, 'ceilings.json');
  writeFileSync(ceilings, JSON.stringify({ task1: 0.41, task2: 0.21, task3: 0.11, per_harness: {}, source: 'test', derived_at: '2026-10-31T00:00:00Z' }));
  const noRuntime = join(tmp, 'runtime-none.json');
  writeFileSync(noRuntime, '{}');
  // A docker stub: image inspect answers .Id with sha256:stub-<tag suffix>, the commit label with the full SHA for gstack-<sha8>
  // tags (STUB_MAP/<sha8>) or STUB_NONE_COMMIT (default none) for gstack-none tags, and the Hermes mode label with
  // STUB_NONE_HERMES_MODE for the none image, else STUB_HERMES_MODE (default chat).
  const stubBin = join(tmp, 'bin'); mkdirSync(stubBin);
  writeFileSync(join(stubBin, 'docker'), [
    '#!/usr/bin/env bash',
    'if [ "$1" = image ] && [ "$2" = inspect ]; then',
    '  tag=$3 fmt=$5',
    '  case "$fmt" in',
    '    *.Id*) echo "sha256:stub-${tag##*:}" ;;',
    '    *gstack.commit*) case "$tag" in *:gstack-none*) echo "${STUB_NONE_COMMIT-none}" ;; *) cat "$STUB_MAP/$(sed -E \'s/.*gstack-([0-9a-f]{8}).*/\\1/\' <<< "$tag")" ;; esac ;;',
    '    *hermes_mode*) case "$tag" in *:gstack-none*) echo "${STUB_NONE_HERMES_MODE:-${STUB_HERMES_MODE:-chat}}" ;; *) echo "${STUB_HERMES_MODE:-chat}" ;; esac ;;',
    '  esac',
    '  exit 0',
    'fi',
    'echo "stub docker: unexpected $*" >&2; exit 1',
  ].join('\n') + '\n');
  chmodSync(join(stubBin, 'docker'), 0o755);
  const stubMap = join(tmp, 'stub-map'); mkdirSync(stubMap);
  for (const c of [c1, c2]) writeFileSync(join(stubMap, c.slice(0, 8)), c);
  const stubEnv = (extra: Record<string, string> = {}) => ({ ...ENV, PATH: stubBin + ':' + ENV.PATH, STUB_MAP: stubMap, ...extra });
  // A docker stub with no images built, so the dry runs below do not depend on what this machine has built.
  const bareBin = join(tmp, 'bare-bin'); mkdirSync(bareBin);
  writeFileSync(join(bareBin, 'docker'), '#!/usr/bin/env bash\necho "Error: No such image: $3" >&2\nexit 1\n');
  chmodSync(join(bareBin, 'docker'), 0o755);
  const bareEnv = { ...ENV, PATH: bareBin + ':' + ENV.PATH };
  const run = (id: string, arms: string, extra: string[] = [], env: Record<string, string> = ENV, dry = true) =>
    spawnSync('bash', [sh, '--arms', arms, '--gstack-dir', repo, '--run-id', id, '--ceilings', ceilings, '--runtime-preflight', noRuntime, ...(dry ? ['--dry-run'] : []), ...extra], { cwd: ROOT, env: { ...env, HOME: tmp }, encoding: 'utf8' });
  const outDir = (id: string, dry = true) => join(ROOT, 'results/gsta-135/runs', id + (dry ? '-dry-run' : ''));
  const three = 'none,baseline:' + c1 + ',candidate:' + c2, two = 'baseline:' + c1 + ',candidate:' + c2;

  test('dry runs: three arms at --trials 8 write 144 rows in lease.ts\'s three-arm order, two arms write 96 as before', () => {
    const id3 = 'test-harn18-dry3-' + process.pid, id2 = 'test-harn18-dry2-' + process.pid;
    try {
      const r3 = run(id3, three, ['--trials', '8', '--hermes-mode', 'chat'], bareEnv);
      expect({ status: r3.status, stderr: r3.stderr.slice(-800) }).toMatchObject({ status: 0 });
      expect(r3.stderr.match(/is not built; a paid run refuses here/g)).toHaveLength(6);
      expect(r3.stderr).toContain('image harness-eval/openclaw:gstack-none is not built');
      expect(r3.stderr).toContain('image harness-eval/hermes:gstack-none-chat is not built');
      const m3 = JSON.parse(readFileSync(join(outDir(id3), 'manifest.json'), 'utf8'));
      expect(Object.keys(m3.arms)).toEqual(['none', 'baseline', 'candidate']);
      expect(m3.arms.none).toEqual({ gstack_sha: 'none', images: { openclaw: { tag: 'harness-eval/openclaw:gstack-none', digest: 'missing' }, hermes: { tag: 'harness-eval/hermes:gstack-none-chat', digest: 'missing' } } });
      expect(m3.arms.baseline.gstack_sha).toBe(c1);
      expect(m3.order).toEqual(panelOrder(8, PANEL_ARMS_WITH_NONE));
      expect(m3.runtime_preflight['harness-eval/hermes:gstack-none-chat']).toBe('not_run');
      const cells3 = rows(join(outDir(id3), 'cells.jsonl'));
      expect(cells3).toHaveLength(144);
      expect(cells3.map(c => c.trial_id)).toEqual(panelOrder(8, PANEL_ARMS_WITH_NONE).map(o => o.trial_id));
      expect(new Set(cells3.map(c => c.termination))).toEqual(new Set(['not_run:dry_run']));
      expect(cells3.find(c => c.trial_id === 'gsta135-hermes-t2-none-3')).toMatchObject({ arm: 'none', image: 'harness-eval/hermes:gstack-none-chat', image_digest: 'missing' });
      expect(cells3.filter(c => c.arm === 'none')).toHaveLength(48);
      const r2 = run(id2, two, ['--trials', '8', '--hermes-mode', 'chat'], bareEnv);
      expect({ status: r2.status, stderr: r2.stderr.slice(-800) }).toMatchObject({ status: 0 });
      expect(r2.stderr.match(/is not built; a paid run refuses here/g)).toHaveLength(4);
      expect(r2.stderr).not.toContain('gstack-none');
      const m2 = JSON.parse(readFileSync(join(outDir(id2), 'manifest.json'), 'utf8'));
      expect(Object.keys(m2.arms)).toEqual(['baseline', 'candidate']);
      expect(m2.order).toEqual(panelOrder(8));
      const cells2 = rows(join(outDir(id2), 'cells.jsonl'));
      expect(cells2).toHaveLength(96);
      expect(cells2.map(c => c.trial_id)).toEqual(panelOrder(8).map(o => o.trial_id));
      const oneshot = run(id3, three, ['--trials', '1', '--hermes-mode', 'oneshot']);
      expect({ status: oneshot.status, stderr: oneshot.stderr.slice(-400) }).toMatchObject({ status: 0 });
      expect(oneshot.stderr).toContain('image harness-eval/hermes:gstack-none is not built');
      const oneshot2 = run(id2, two, ['--trials', '1', '--hermes-mode', 'oneshot']);
      expect({ status: oneshot2.status, stderr: oneshot2.stderr.slice(-400) }).toMatchObject({ status: 0 });
      expect(JSON.parse(readFileSync(join(outDir(id2), 'manifest.json'), 'utf8')).arms.baseline.images.hermes.tag).toBe('harness-eval/hermes:gstack-' + c1.slice(0, 8));
      expect(JSON.parse(readFileSync(join(outDir(id3), 'manifest.json'), 'utf8')).arms.none.images.hermes.tag).toBe('harness-eval/hermes:gstack-none');
    } finally { rmSync(outDir(id3), { recursive: true, force: true }); rmSync(outDir(id2), { recursive: true, force: true }); }
  }, 180_000);
  test('the none images\' labels: commit must be none and the Hermes mode must match, else exit 2; matching labels pass with the image ids in the manifest', () => {
    const id = 'test-harn18-lbl-' + process.pid;
    try {
      const wrongCommit = run(id, three, ['--hermes-mode', 'chat'], stubEnv({ STUB_NONE_COMMIT: c1 }));
      expect(wrongCommit.status).toBe(2);
      expect(wrongCommit.stderr).toContain('image harness-eval/openclaw:gstack-none carries org.harness-eval.gstack.commit=' + c1 + ', not none; rebuild it with --build-arg GSTACK_COMMIT=none');
      expect(existsSync(outDir(id))).toBe(false);
      const unlabelled = run(id, three, ['--hermes-mode', 'chat'], stubEnv({ STUB_NONE_COMMIT: '' }));
      expect(unlabelled.status).toBe(2);
      expect(unlabelled.stderr).toContain('carries org.harness-eval.gstack.commit=<none>, not none');
      const wrongMode = run(id, three, ['--hermes-mode', 'chat'], stubEnv({ STUB_NONE_HERMES_MODE: 'oneshot' }));
      expect(wrongMode.status).toBe(2);
      expect(wrongMode.stderr).toContain('image harness-eval/hermes:gstack-none-chat carries org.harness-eval.gstack.hermes_mode=oneshot, not --hermes-mode chat');
      expect(existsSync(outDir(id))).toBe(false);
      const ok = run(id, three, ['--hermes-mode', 'chat', '--trials', '1'], stubEnv());
      expect({ status: ok.status, stderr: ok.stderr.slice(-800) }).toMatchObject({ status: 0 });
      expect(ok.stderr).not.toContain('is not built');
      const manifest = JSON.parse(readFileSync(join(outDir(id), 'manifest.json'), 'utf8'));
      expect(manifest.arms.none.images).toEqual({ openclaw: { tag: 'harness-eval/openclaw:gstack-none', digest: 'sha256:stub-gstack-none' }, hermes: { tag: 'harness-eval/hermes:gstack-none-chat', digest: 'sha256:stub-gstack-none-chat' } });
      expect(rows(join(outDir(id), 'cells.jsonl'))).toHaveLength(18);
    } finally { rmSync(outDir(id), { recursive: true, force: true }); }
  }, 120_000);
  test('the arm list is validated, and a baseline equal to the candidate is refused outside a dry run', () => {
    const id = 'test-harn18-arms-' + process.pid;
    try {
      for (const bad of ['none,baseline:' + c1, 'baseline:' + c1 + ',candidate:' + c2 + ',none', 'none:' + c1 + ',baseline:' + c1 + ',candidate:' + c2, 'none,candidate:' + c2 + ',baseline:' + c1]) {
        const r = run(id, bad);
        expect({ bad, status: r.status }).toEqual({ bad, status: 64 });
        expect(r.stderr).toContain('--arms must be baseline:<sha>,candidate:<sha> or none,baseline:<sha>,candidate:<sha>');
      }
      for (const arms of ['baseline:' + c1 + ',candidate:' + c1, 'none,baseline:' + c1 + ',candidate:' + c1]) {
        const paid = run(id, arms, ['--hermes-mode', 'chat'], stubEnv(), false);
        expect({ arms, status: paid.status }).toEqual({ arms, status: 2 });
        expect(paid.stderr).toContain('baseline and candidate are the same commit ' + c1 + '; the arms would not differ, so a paid panel is refused');
        expect(existsSync(outDir(id, false))).toBe(false);
        const dry = run(id, arms, ['--trials', '1']);
        expect(dry.status).toBe(0);
        expect(dry.stderr).toContain('same commit');
      }
      const fake = run(id, 'baseline:' + c1 + ',candidate:' + c1, ['--hermes-mode', 'chat'], { ...ENV, HE_PROXY_UPSTREAM: 'http://127.0.0.1:9' }, false);
      expect(fake.status).toBe(2);
      expect(fake.stderr).toContain('same commit');
      expect(fake.stderr).toContain('is not built (docker image inspect)');
      const relay = run(id, 'baseline:' + c1 + ',candidate:' + c1, ['--hermes-mode', 'chat'], { ...ENV, HE_PROXY_UPSTREAM: 'https://api.anthropic.com' }, false);
      expect(relay.status).toBe(2);
      expect(relay.stderr).toContain('so a paid panel is refused');
    } finally { rmSync(outDir(id), { recursive: true, force: true }); rmSync(outDir(id, false), { recursive: true, force: true }); }
  }, 120_000);
  test('the panel manifest records the upstream: default without HE_PROXY_UPSTREAM, else its value (panel-score refuses anything but default)', () => {
    const id = 'test-harn18-upstream-' + process.pid;
    try {
      const plain = run(id, three, ['--trials', '1']);
      expect({ status: plain.status, stderr: plain.stderr.slice(-800) }).toMatchObject({ status: 0 });
      expect(JSON.parse(readFileSync(join(outDir(id), 'manifest.json'), 'utf8')).upstream).toBe('default');
      rmSync(outDir(id), { recursive: true, force: true });
      const fake = run(id, three, ['--trials', '1'], { ...ENV, HE_PROXY_UPSTREAM: 'http://127.0.0.1:9' });
      expect({ status: fake.status, stderr: fake.stderr.slice(-800) }).toMatchObject({ status: 0 });
      expect(JSON.parse(readFileSync(join(outDir(id), 'manifest.json'), 'utf8')).upstream).toBe('http://127.0.0.1:9');
    } finally { rmSync(outDir(id), { recursive: true, force: true }); }
  }, 120_000);
});

describe('the GSTACK_COMMIT=none overlay', () => {
  const LIB = join(ROOT, 'harnesses', '_gstack', 'wrapper-lib.sh');
  /** A copy of an overlay adapter that sources the repository's wrapper-lib.sh instead of the image path. */
  const adapter = (h: 'openclaw' | 'hermes') => {
    const p = join(tmp, h + '-adapter-' + Math.random().toString(36).slice(2) + '.sh');
    writeFileSync(p, readFileSync(join(ROOT, 'harnesses', h, 'gstack', 'adapter.sh'), 'utf8').replace('. /opt/harness/gstack/wrapper-lib.sh', '. ' + LIB));
    return p;
  };
  const real = join(tmp, 'real-adapter.sh');
  writeFileSync(real, '#!/usr/bin/env bash\necho "real $* budget=$HE_TIME_BUDGET_S"\n');
  chmodSync(real, 0o755);
  /** A fake gstack checkout whose setup prints the ready line, for the gstack-arm path. */
  const fakeGstack = (host: string) => {
    const d = mkdtempSync(join(tmp, 'gstack-'));
    mkdirSync(join(d, 'bin'));
    writeFileSync(join(d, 'VERSION'), '9.9.9\n');
    writeFileSync(join(d, 'setup'), '#!/usr/bin/env bash\necho "gstack ready (' + host + ')"\n');
    chmodSync(join(d, 'setup'), 0o755);
    const git = (...a: string[]) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { env: ENV, encoding: 'utf8' }).trim();
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fake gstack');
    return d;
  };
  const headOf = (d: string) => execFileSync('git', ['-C', d, 'rev-parse', 'HEAD'], { env: ENV, encoding: 'utf8' }).trim();
  const runAdapter = (h: 'openclaw' | 'hermes', gstackDir: string, extra: Record<string, string> = {}) => {
    const state = mkdtempSync(join(tmp, 'state-')), logs = mkdtempSync(join(tmp, 'logs-'));
    const r = spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: { PATH: ENV.PATH, HE_LOG_DIR: logs, HE_SESSION_STATE_DIR: state, HE_TIME_BUDGET_S: '600', HE_TRIAL_ID: 't', GSTACK_DIR: gstackDir, GSTACK_WRAP_REAL: real, GSTACK_WRAP_CONFIG_DIR: join(ROOT, 'harnesses', h, 'config'), ...extra } });
    return { ...r, state, logs, log: readFileSync(join(logs, 'gstack-register.log'), 'utf8') };
  };
  test('OpenClaw: no /opt/gstack logs gstack: none, registers nothing and hands off after the same marker and runtime check', () => {
    const r = runAdapter('openclaw', join(tmp, 'no-gstack'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toMatch(/^real run budget=(600|59[0-9])\n$/);
    expect(r.log).toContain('marker: harnesses/_gstack/wrapper-lib.sh:');
    expect(r.log).toMatch(/runtime: unknown \(bun [0-9.]+; gstack: none, no \S+ and no minimum to check\)/);
    expect(r.log).toContain('gstack: none (no ' + join(tmp, 'no-gstack') + ' in this image, built with GSTACK_COMMIT=none; registration and setup skipped)');
    expect(r.log).toContain('openclaw overlay: gstack none bun ');
    expect(r.log).toContain('budget: given 600s');
    expect(r.log).not.toContain('degraded');
    expect(existsSync(join(r.logs, 'gstack-setup.log'))).toBe(false);
  });
  test('OpenClaw and Hermes one-shot with a gstack checkout still run setup and never log gstack: none', () => {
    const ocDir = fakeGstack('openclaw');
    const oc = runAdapter('openclaw', ocDir, { GSTACK_IMAGE_COMMIT: headOf(ocDir) });
    expect(oc.status).toBe(0);
    expect(oc.stdout).toMatch(/^real run budget=(600|59[0-9])\n$/);
    expect(oc.log).toContain('setup: gstack ready (openclaw)');
    expect(oc.log).toContain('openclaw overlay: gstack 9.9.9 at ');
    expect(oc.log).not.toContain('gstack: none');
    const heDir = fakeGstack('hermes');
    const he = runAdapter('hermes', heDir, { HE_GSTACK_HERMES_MODE: 'oneshot', GSTACK_IMAGE_COMMIT: headOf(heDir) });
    expect(he.status).toBe(0);
    expect(he.log).toContain('setup: gstack ready (hermes)');
    expect(he.log).not.toContain('gstack: none');
  });
  test('an image built with a gstack commit but no /opt/gstack fails setup instead of running without gstack', () => {
    for (const [h, extra] of [['openclaw', {}], ['hermes', { HE_GSTACK_HERMES_MODE: 'oneshot' }]] as const) {
      const r = runAdapter(h, join(tmp, 'no-gstack'), { ...extra, GSTACK_IMAGE_COMMIT: 'bd8907d6f53465c5e3679af20005fd0267fa436a' });
      expect([h, r.status]).toEqual([h, 2]);
      expect(r.stdout).not.toContain('real run');
      expect(r.log).toContain('FAIL: no ' + join(tmp, 'no-gstack') + ', but this image was built with GSTACK_COMMIT=bd8907d6f53465c5e3679af20005fd0267fa436a');
      expect(r.log).not.toContain('gstack: none (no ');
    }
    expect(runAdapter('openclaw', join(tmp, 'no-gstack'), { GSTACK_IMAGE_COMMIT: 'none' }).status).toBe(0);
  });
  test('Hermes one-shot: no /opt/gstack skips setup and hands off', () => {
    const r = runAdapter('hermes', join(tmp, 'no-gstack'), { HE_GSTACK_HERMES_MODE: 'oneshot' });
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toMatch(/^real run budget=(600|59[0-9])\n$/);
    expect(r.log).toContain('gstack: none (no ');
    expect(r.log).toContain('hermes overlay: gstack none bun ');
    expect(r.log).toContain('mode=oneshot');
    expect(existsSync(join(r.logs, 'gstack-setup.log'))).toBe(false);
  });
  test('Hermes chat: no /opt/gstack still writes the approvals block and logs the approval line, then runs the chat turn block', () => {
    const work = mkdtempSync(join(tmp, 'workspace-'));
    const state = mkdtempSync(join(tmp, 'state-'));
    mkdirSync(join(state, 'hermes'));
    writeFileSync(join(state, 'hermes', 'config.yaml'), 'model:\n  default: x\n');
    const logs = mkdtempSync(join(tmp, 'logs-'));
    const r = spawnSync('bash', [adapter('hermes'), 'run'], { encoding: 'utf8', env: { PATH: ENV.PATH, HE_LOG_DIR: logs, HE_SESSION_STATE_DIR: state, HE_TIME_BUDGET_S: '600', HE_TRIAL_ID: 't', GSTACK_DIR: join(tmp, 'no-gstack'), GSTACK_WRAP_REAL: real,
      HE_GSTACK_HERMES_MODE: 'chat', HE_WORKSPACE_DIR: work, HE_MODEL_BASE_URL: 'http://127.0.0.1:9/t/anthropic', HE_MODEL_API_KEY: 'trial-token:placeholder', HE_MODEL_NAME: 'claude-opus-5-5' } });
    const log = readFileSync(join(logs, 'gstack-register.log'), 'utf8');
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain('real run');
    expect(log).toContain('gstack: none (no ');
    expect(log).toContain('hermes overlay: gstack none bun ');
    expect(log).toContain('mode=chat');
    expect(log).toContain('approval: approvals.mode=manual approvals.timeout=1');
    expect(readFileSync(join(state, 'hermes', 'config.yaml'), 'utf8')).toBe('model:\n  default: x\n\napprovals:\n  mode: "manual"\n  timeout: 1\n');
    expect(readFileSync(join(logs, 'adapter.log'), 'utf8')).toContain('entry=run mode=chat');
    expect(readFileSync(join(logs, 'adapter.log'), 'utf8')).toContain('no readable ' + work + '/instruction.md');
  });
  test('both overlay Dockerfiles skip the checkout, bun install and setup for GSTACK_COMMIT=none and keep everything else', () => {
    for (const h of ['openclaw', 'hermes']) {
      const src = readFileSync(join(ROOT, 'harnesses', h, 'gstack', 'Dockerfile'), 'utf8');
      const run = src.match(/^RUN if \[ "\$\{GSTACK_COMMIT\}" = none \]; then \\\n[\s\S]*?\n    fi\n/m)![0];
      const [none, gstack] = run.split('    else \\\n');
      expect(none).not.toMatch(/git (init|fetch|checkout|config)|bun install --|\.\/setup --host/);
      expect(none).toContain('rm -rf /opt/bun/install/cache && chmod -R a+rwX /opt/bun');
      expect(gstack).toContain('test "$(git rev-parse HEAD)" = "${GSTACK_COMMIT}"');
      expect(gstack).toContain('bun install --frozen-lockfile');
      expect(gstack).toContain('./setup --host ' + h + ' --no-browser');
      const body = run.replace(/^RUN /, '').replace(/\\\n/g, ' ');
      expect(spawnSync('sh', ['-n', '-c', body], { encoding: 'utf8' }).status).toBe(0);
      const rest = src.replace(run, '');
      expect(rest).toContain('bash -s "bun-v${BUN_VERSION}"');
      expect(rest).toContain('COPY _gstack/wrapper-lib.sh /opt/harness/gstack/wrapper-lib.sh');
      expect(rest).toContain('RUN mv /opt/harness/adapter.sh /opt/harness/adapter.real.sh');
      expect(rest).toContain('LABEL org.harness-eval.gstack.commit="${GSTACK_COMMIT}"');
      expect(rest).toContain('GSTACK_DIR=/opt/gstack GSTACK_IMAGE_COMMIT=${GSTACK_COMMIT}');
      if (h === 'hermes') { expect(rest).toContain("RUN printf 'export PATH=\"/opt/bun/bin:$PATH\"\\n' > /etc/profile.d/bun.sh"); expect(rest).toContain('org.harness-eval.gstack.hermes_mode="${HE_GSTACK_HERMES_MODE}"'); }
    }
  });
});
