// internal-task evidence extractor on the 12 captured discovery stores (tests/fixtures/gsta-135/<trial>/known.json: its `about`
// says which fields were hand-read from the discovery report and which were derived by running the extractor, and its
// `provenance` names the fact each metric rests on, which this file checks against the store) and on synthetic paired fixtures
// for every metric predicate: each has a positive and a negative built from the native store shapes. Keyless; no docker.
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classify, extract, sha256, startedSkill, taskSuccessMatch } from '../scripts/gsta-135/evidence.ts';

const ROOT = join(import.meta.dir, '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'gsta-135');
const tmp = () => mkdtempSync(join(tmpdir(), 'gsta135-ev-test-'));

describe('the 12 captured discovery stores', () => {
  const trials = readdirSync(FIX).filter(d => d.startsWith('gsta135-')).sort();
  test('twelve fixtures, six per harness, no side files', () => {
    expect(trials.length).toBe(12);
    expect(trials.filter(t => t.includes('-openclaw-')).length).toBe(6);
    for (const t of trials) {
      const known = JSON.parse(readFileSync(join(FIX, t, 'known.json'), 'utf8'));
      expect(readdirSync(join(FIX, t, known.store.path, '..'))).toEqual([known.store.path.split('/').pop()]);
    }
  });
  for (const t of trials) {
    test(t + ' reproduces known.json', () => {
      const known = JSON.parse(readFileSync(join(FIX, t, 'known.json'), 'utf8'));
      const store = join(FIX, t, known.store.path);
      expect(sha256(store)).toBe(known.store.sha256);
      const ev = extract(known.harness, join(FIX, t), known.task);
      expect(ev.transcript).toBe(known.transcript);
      expect(ev.tool_calls).toBe(known.tool_calls);
      expect(ev.gstack_paths).toBe(known.gstack_paths);
      expect(ev.termination_hint).toBe(known.termination_hint);
      expect(ev.metrics.router_opened).toBe(known.router_opened);
      expect(ev.metrics).toMatchObject(known.metrics);
      expect(ev.files[0]).toMatchObject({ path: store, sha256: known.store.sha256, bytes: known.store.bytes });
      expect(ev.unmatched_results).toBe(0);
      for (const e of ev.events) expect(e.result).toBe('ok');
      if (known.arm === 'none') expect(ev.events).toEqual([]);
      expect(known.about).toContain('Hand-read from the discovery report');
      const p = known.provenance;
      if (known.task === 3) expect(p.task_success).toBe('task 3 has no success notion');
      else {
        expect(ev.final_text).toContain(p.task_success.final_text_excerpt);
        expect(taskSuccessMatch(known.task, ev.final_text!)).toBe(p.task_success.cue);
        expect(p.task_success.cue !== null).toBe(known.metrics.task_success);
        expect(p.task_success.final_text_excerpt.toLowerCase()).toContain(String(p.task_success.cue).toLowerCase());
        expect(new Bun.CryptoHasher('sha256').update(ev.final_text!).digest('hex')).toBe(p.task_success.final_text_sha256);
      }
      const opens = ev.events.filter(e => e.kind === 'skill_open').map(e => ({ locator: e.locator, tool: e.tool, skill: e.skill, result: e.result, detail: e.detail }));
      expect(opens.length ? opens : 'no skill_open event: no skills_read/skill_view of gstack or read of a gstack SKILL.md in the store').toEqual(p.skill_opens);
      expect(ev.events.some(e => e.kind === 'helper_run')).toBe(Array.isArray(p.helper_runs));
      expect(Array.isArray(p.started_attempted)).toBe(known.metrics.started_attempted === 1);
      expect(ev.note).toContain('final text from ' + p.main_session);
    });
  }
  test('the CLI prints the metrics object with --task and still prints the excerpt', () => {
    const dir = join(FIX, 'gsta135-openclaw-t1-gstack');
    const r = spawnSync('bun', [join(ROOT, 'scripts', 'gsta-135', 'evidence.ts'), 'openclaw', dir, '--task', '1'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.metrics).toMatchObject({ task: 1, matching_skill_opened: 1, matching_skill_started: 0, control_false_open: null, task_success: true, skills_opened: ['gstack-review'] });
    expect(out.skill_open.detail).toBe('read ~/openclaw/skills/gstack/SKILL.md');
    expect(out.excerpt).toBeUndefined();
    const noTask = JSON.parse(spawnSync('bun', [join(ROOT, 'scripts', 'gsta-135', 'evidence.ts'), 'openclaw', dir], { encoding: 'utf8' }).stdout);
    expect(noTask.metrics).toMatchObject({ task: null, matching_skill_opened: null, matching_skill_started: null, task_success: null, skills_opened: ['gstack-review'] });
    const ex = spawnSync('bun', [join(ROOT, 'scripts', 'gsta-135', 'evidence.ts'), 'openclaw', dir, '--task', '1', '--excerpt'], { encoding: 'utf8' });
    expect(ex.stdout).toContain('toolResult read: ');
    expect(ex.stdout).toContain('toolResult exec (exit 0): ');
    expect(spawnSync('bun', [join(ROOT, 'scripts', 'gsta-135', 'evidence.ts'), 'openclaw', dir, '--task', '4'], { encoding: 'utf8' }).status).toBe(64);
  });
});

// OpenClaw store shapes as the pinned image writes them: toolCall blocks with ids, toolResult messages with toolCallId,
// isError and details.exitCode.
function openclawFixture(events: unknown[]): string {
  const dir = tmp();
  const d = join(dir, 'state', 'openclaw', 'exec', 'agents', 'main', 'agent');
  mkdirSync(d, { recursive: true });
  const db = new Database(join(d, 'openclaw-agent.sqlite'));
  db.run('create table transcript_events (session_id text, seq integer, event_json text, event_zstd blob, created_at integer)');
  events.forEach((e: any, i) => { const row = e && typeof e === 'object' && 'session' in e && 'event' in e ? e : { session: 's1', event: e }; db.run('insert into transcript_events values (?, ?, ?, null, ?)', [row.session, i, JSON.stringify(row.event), 1000 + i]); });
  db.close();
  return dir;
}
const inSession = (session: string, event: unknown) => ({ session, event });
const user = (text: string) => ({ type: 'message', message: { role: 'user', content: text } });
const assistant = (content: unknown[], stopReason = content.some((b: any) => b.type === 'toolCall') ? 'toolUse' : 'stop') => ({ type: 'message', message: { role: 'assistant', content, stopReason } });
const call = (id: string, name: string, args: unknown) => ({ type: 'toolCall', id, name, arguments: args });
const result = (id: string, name: string, text: string, opts: { isError?: boolean; exitCode?: number | null; truncated?: boolean } = {}) =>
  ({ type: 'message', message: { role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError: opts.isError ?? false, details: opts.truncated ? { persistedDetailsTruncated: true } : name === 'exec' ? { status: 'completed', exitCode: opts.exitCode ?? 0 } : { kind: 'file' } } });
const REVIEW = '/harness-state/openclaw/skills/gstack/skills/gstack-review/SKILL.md';
const ROUTER = '/harness-state/openclaw/skills/gstack/SKILL.md';
const START = '/opt/gstack/bin/gstack-skill-start --skill review --model claude';

describe('OpenClaw metric predicates, paired', () => {
  test('matching_skill_opened needs a successful read of the matching skill; an error result or the router alone counts 0', () => {
    const ok = extract('openclaw', openclawFixture([user('Review the uncommitted change in this repo before I merge it.'),
      assistant([call('a', 'read', { path: ROUTER })]), result('a', 'read', '---\nname: gstack'),
      assistant([call('b', 'read', { path: REVIEW })]), result('b', 'read', '---\nname: review'),
      assistant([{ type: 'text', text: "Don't merge this: off-by-one in window.py." }])]), 1);
    expect(ok.metrics).toMatchObject({ matching_skill_opened: 1, router_opened: 1, skills_opened: ['gstack-review'], other_skills_opened: [], task_success: true, matching_skill_started: 0, started_attempted: 0 });
    expect(ok.events.map(e => [e.skill, e.result])).toEqual([['gstack', 'ok'], ['gstack-review', 'ok']]);
    const err = extract('openclaw', openclawFixture([user('Review the uncommitted change in this repo before I merge it.'),
      assistant([call('a', 'read', { path: ROUTER })]), result('a', 'read', '---\nname: gstack'),
      assistant([call('b', 'read', { path: REVIEW })]), result('b', 'read', 'ENOENT: no such file', { isError: true }),
      assistant([{ type: 'text', text: 'Looks good, merge it.' }])]), 1);
    expect(err.transcript).toBe('complete');
    expect(err.metrics).toMatchObject({ matching_skill_opened: 0, router_opened: 1, skills_opened: [], task_success: false });
    expect(err.events[1]).toMatchObject({ skill: 'gstack-review', result: 'error' });
    expect(err.sub_skill_open).not.toBeNull();
  });
  test('matching_skill_started needs exit 0 in the native result; exit 1, a lost exit code or no result is an attempt', () => {
    const turn = (res: unknown[]) => extract('openclaw', openclawFixture([user('Review the uncommitted change in this repo before I merge it.'),
      assistant([call('b', 'read', { path: REVIEW })]), result('b', 'read', '---\nname: review'),
      assistant([call('c', 'exec', { command: START })]), ...res]), 1);
    const started = turn([result('c', 'exec', 'SKILL_START_PROTO: 1\nSESSION_ID: x', { exitCode: 0 }), assistant([{ type: 'text', text: 'Do not merge.' }])]);
    expect(started.metrics).toMatchObject({ matching_skill_opened: 1, matching_skill_started: 1, started_attempted: 1, started_exit: 0 });
    expect(started.helper_run).toMatchObject({ skill: 'gstack-review', result: 'ok', exit: 0 });
    const failed = turn([result('c', 'exec', 'bash: bun: command not found', { exitCode: 127 }), assistant([{ type: 'text', text: 'Do not merge.' }])]);
    expect(failed.metrics).toMatchObject({ matching_skill_started: 0, started_attempted: 1, started_exit: 127 });
    expect(failed.helper_run).toMatchObject({ result: 'error', exit: 127 });
    const lost = turn([result('c', 'exec', 'SKILL_START_PROTO: 1', { truncated: true }), assistant([{ type: 'text', text: 'Do not merge.' }])]);
    expect(lost.metrics).toMatchObject({ matching_skill_started: 0, started_attempted: 1, started_exit: null });
    expect(lost.helper_run).toMatchObject({ result: 'unknown', exit: null });
    const cut = turn([]);
    expect(cut.transcript).toBe('truncated');
    expect(cut.metrics).toMatchObject({ matching_skill_started: 0, started_attempted: 1, task_success: null });
    expect(cut.helper_run!.result).toBe('none');
  });
  test('the exit must be the helper\'s own: a helper followed by || true, ; echo or a pipe is an ambiguous attempt, never a start', () => {
    const run = (command: string, exitCode = 0) => extract('openclaw', openclawFixture([user('Review the uncommitted change in this repo before I merge it.'),
      assistant([call('c', 'exec', { command })]), result('c', 'exec', 'SKILL_START_PROTO: 1', { exitCode }), assistant([{ type: 'text', text: 'Do not merge.' }])]), 1).metrics;
    for (const command of [START + ' || true', START + ' || :', START + '; echo done', START + ' && echo ok', START + ' 2>&1 | tee /tmp/start.log', 'if ' + START + '; then echo ok; fi', 'out=$(' + START + '); echo "$out"']) {
      expect([command, run(command)]).toEqual([command, expect.objectContaining({ matching_skill_started: 0, started_attempted: 1, started_exit: 'ambiguous' })]);
    }
    for (const command of [START, 'cd /workspace && ' + START, 'git status; ' + START, 'cd /workspace; timeout 30 ' + START + ' ', "bash -c '" + START + "'", START + ' # start the review']) {
      expect([command, run(command)]).toEqual([command, expect.objectContaining({ matching_skill_started: 1, started_attempted: 1, started_exit: 0 })]);
      expect(run(command, 3)).toMatchObject({ matching_skill_started: 0, started_attempted: 1, started_exit: 3 });
    }
    expect(run("bash -c '" + START + " || true'")).toMatchObject({ matching_skill_started: 0, started_exit: 'ambiguous' });
    expect(run("bash -c '" + START + "' || true")).toMatchObject({ matching_skill_started: 0, started_exit: 'ambiguous' });
  });
  test('the --skill is read from the helper\'s own argv, never from another command in the string', () => {
    const run = (command: string) => extract('openclaw', openclawFixture([user('Review the uncommitted change in this repo before I merge it.'),
      assistant([call('c', 'exec', { command })]), result('c', 'exec', 'SKILL_START_PROTO: 1', { exitCode: 0 }), assistant([{ type: 'text', text: 'Do not merge.' }])]), 1);
    const other = run('echo --skill review; /opt/gstack/bin/gstack-skill-start --skill qa');
    expect(other.helper_run).toMatchObject({ skill: 'gstack-qa', result: 'ok', exit: 0, exit_belongs: true });
    expect(other.metrics).toMatchObject({ matching_skill_started: 0, started_attempted: 0 });
    expect(run('/opt/gstack/bin/gstack-skill-start --skill qa; echo --skill review').helper_run).toMatchObject({ skill: 'gstack-qa', exit_belongs: false });
    expect(run('/opt/gstack/bin/gstack-skill-start --model claude --skill=gstack-review').metrics).toMatchObject({ matching_skill_started: 1 });
    expect(run('/opt/gstack/bin/gstack-skill-start --help').helper_run).toMatchObject({ skill: null, exit_belongs: true });
    expect(startedSkill('echo --skill review; gstack-skill-start --skill qa')).toBe('gstack-qa');
    expect(startedSkill('gstack-skill-start --skill')).toBeNull();
  });
  test('the wrong skill never counts as the matching start or open, and lands in other_skills_opened', () => {
    const ev = extract('openclaw', openclawFixture([user('The test suite fails. Find out why.'),
      assistant([call('b', 'read', { path: REVIEW })]), result('b', 'read', '---\nname: review'),
      assistant([call('c', 'exec', { command: START })]), result('c', 'exec', 'SKILL_START_PROTO: 1', { exitCode: 0 }),
      assistant([{ type: 'text', text: 'The new test expects an inclusive end.' }])]), 2);
    expect(ev.metrics).toMatchObject({ matching_skill: ['gstack-investigate', 'gstack-qa'], matching_skill_opened: 0, matching_skill_started: 0, started_attempted: 0, skills_opened: ['gstack-review'], other_skills_opened: ['gstack-review'], task_success: true });
  });
  test('task 2 accepts gstack-qa as well as gstack-investigate', () => {
    const qa = extract('openclaw', openclawFixture([user('The test suite fails. Find out why.'),
      assistant([call('b', 'read', { path: '/harness-state/openclaw/skills/gstack/skills/gstack-qa/SKILL.md' })]), result('b', 'read', '---\nname: qa'),
      assistant([{ type: 'text', text: 'The failing test is test_window_includes_its_last_day.' }])]), 2);
    expect(qa.metrics).toMatchObject({ matching_skill_opened: 1, skills_opened: ['gstack-qa'], other_skills_opened: [], task_success: true });
    expect(classify({ tool: 'read', args: { path: '/harness-state/openclaw/skills/gstack/skills/gstack-qa/SKILL.md' }, locator: 'x', file: 'f', sha256: 'd' }, 'openclaw')[0]).toMatchObject({ kind: 'skill_open', skill: 'gstack-qa', result: 'none' });
  });
  test('control_false_open counts a successful open of anything, the router included, on task 3 only', () => {
    const open = extract('openclaw', openclawFixture([user('Write a two-line poem about the sea.'),
      assistant([call('a', 'read', { path: ROUTER })]), result('a', 'read', '---\nname: gstack'),
      assistant([{ type: 'text', text: 'Waves fold the light; the shore keeps count.' }])]), 3);
    expect(open.metrics).toMatchObject({ control_false_open: 1, router_opened: 1, skills_opened: [], matching_skill_opened: 0, task_success: null });
    const failedOpen = extract('openclaw', openclawFixture([user('Write a two-line poem about the sea.'),
      assistant([call('a', 'read', { path: ROUTER })]), result('a', 'read', 'ENOENT', { isError: true }),
      assistant([{ type: 'text', text: 'Waves fold the light; the shore keeps count.' }])]), 3);
    expect(failedOpen.metrics).toMatchObject({ control_false_open: 0, router_opened: 0 });
    const none = extract('openclaw', openclawFixture([user('Write a two-line poem about the sea.'), assistant([{ type: 'text', text: 'Waves fold the light; the shore keeps count.' }])]), 3);
    expect(none.metrics).toMatchObject({ control_false_open: 0 });
    expect(extract('openclaw', openclawFixture([user('Review it.'), assistant([call('a', 'read', { path: ROUTER })]), result('a', 'read', 'x'), assistant([{ type: 'text', text: 'Fine.' }])]), 1).metrics.control_false_open).toBeNull();
  });
  test('task_success reads the final assistant text, only on a complete transcript', () => {
    const t1 = (text: string, stop = 'stop') => extract('openclaw', openclawFixture([user('Review the uncommitted change in this repo before I merge it.'), assistant([{ type: 'text', text }], stop)]), 1).metrics.task_success;
    expect(t1("**Don't merge this.** The change creates an off-by-one bug.")).toBe(true);
    expect(t1('This should not be merged: range(n_days + 1) covers one day too many.')).toBe(true);
    expect(t1('I would not merge this yet.')).toBe(true);
    expect(t1('Fix the bound before merging.')).toBe(true);
    expect(t1('Looks good to me. Safe to merge.')).toBe(false);
    expect(t1('Merge it; the change is a harmless refactor.')).toBe(false);
    expect(t1('No off-by-one here; safe to merge.')).toBe(false);
    expect(t1('The change does not introduce an off-by-one. Merge it.')).toBe(false);
    expect(t1("I don't see an off-by-one; this is not an off-by-one error.")).toBe(false);
    expect(t1('Nothing is blocking the merge.')).toBe(false);
    expect(t1('I see no reason it should not be merged.')).toBe(false);
    expect(t1('There is no reason why this shouldn\u2019t be merged.')).toBe(false);
    expect(t1('Safe to merge; before merging update the changelog.')).toBe(false);
    expect(t1('Bump the version before merging.')).toBe(true);
    expect(t1('Do not merge: there is an off-by-one and it is not safe to merge.')).toBe(true);
    expect(t1('Not safe to merge: the loop runs one day too many.')).toBe(true);
    expect(t1('The window has an off-by-one at the end.')).toBe(true);
    expect(t1("Don't merge this.", 'length')).toBeNull();
    const t2 = (text: string) => extract('openclaw', openclawFixture([user('The test suite fails. Find out why.'), assistant([{ type: 'text', text }])]), 2).metrics.task_success;
    expect(t2('The newest test expects an inclusive end and the code is half-open.')).toBe(true);
    expect(t2('InclusiveBoundTests.test_window_includes_its_last_day asserts the wrong list.')).toBe(true);
    expect(t2('The failing assertion is at tests/test_window.py:31.')).toBe(true);
    expect(t2('File "tests/test_window.py", line 31 fails.')).toBe(true);
    expect(t2('pytest is not installed, so the suite cannot run.')).toBe(false);
    expect(t2('The bound is exclusive, not inclusive.')).toBe(false);
    expect(t2('The window is half-open rather than inclusive, so nothing is wrong.')).toBe(false);
    expect(t2("The end isn't inclusive and that is by design.")).toBe(false);
    expect(t2('The test wants an inclusive end, not an exclusive one.')).toBe(true);
    expect(extract('openclaw', openclawFixture([user('Write a two-line poem about the sea.'), assistant([{ type: 'text', text: 'Sea.' }])]), 3).metrics.task_success).toBeNull();
    const twoTexts = extract('openclaw', openclawFixture([user('Review the uncommitted change in this repo before I merge it.'),
      assistant([{ type: 'text', text: 'Looking; do not merge until I finish.' }, call('a', 'exec', { command: 'git diff' })]), result('a', 'exec', 'diff', { exitCode: 0 }),
      assistant([{ type: 'text', text: 'All good, merge it.' }])]), 1);
    expect(twoTexts.final_text).toBe('All good, merge it.');
    expect(twoTexts.metrics.task_success).toBe(false);
  });
  test('a length stop is reported as termination_hint length and leaves the transcript truncated', () => {
    const ev = extract('openclaw', openclawFixture([user('Review the uncommitted change in this repo before I merge it.'),
      assistant([call('b', 'read', { path: REVIEW })]), result('b', 'read', '---\nname: review'),
      assistant([{ type: 'text', text: 'The change' }], 'length')]), 1);
    expect(ev.transcript).toBe('truncated');
    expect(ev.termination_hint).toBe('length');
    expect(ev.metrics).toMatchObject({ matching_skill_opened: 1, task_success: null });
    expect(extract('openclaw', openclawFixture([user('x'), assistant([{ type: 'text', text: 'y' }])]), 1).termination_hint).toBeNull();
  });
  test('a result whose id matches no open call settles nothing and is counted; only an id-less row falls back positionally', () => {
    const base = [user('Review the uncommitted change in this repo before I merge it.'), assistant([call('a', 'read', { path: REVIEW })])];
    const stray = extract('openclaw', openclawFixture([...base, result('zzz', 'read', '---\nname: review'), result('a', 'read', 'ENOENT', { isError: true }), assistant([{ type: 'text', text: 'Do not merge.' }])]), 1);
    expect(stray.transcript).toBe('complete');
    expect(stray.unmatched_results).toBe(1);
    expect(stray.note).toContain('1 result row(s) matching no call');
    expect(stray.events[0]).toMatchObject({ skill: 'gstack-review', result: 'error' });
    expect(stray.metrics.matching_skill_opened).toBe(0);
    const dup = extract('openclaw', openclawFixture([...base, result('a', 'read', 'ENOENT', { isError: true }), result('a', 'read', '---\nname: review'), assistant([{ type: 'text', text: 'Do not merge.' }])]), 1);
    expect(dup.unmatched_results).toBe(1);
    expect(dup.events[0].result).toBe('error');
    expect(dup.metrics.matching_skill_opened).toBe(0);
    const orphan = extract('openclaw', openclawFixture([...base, result('zzz', 'read', '---\nname: review'), assistant([{ type: 'text', text: 'Do not merge.' }])]), 1);
    expect(orphan.transcript).toBe('truncated');
    expect(orphan.events[0].result).toBe('none');
    expect(orphan.excerpt.some(l => l.includes('(matches no waiting call)'))).toBe(true);
    const noId = { type: 'message', message: { role: 'toolResult', toolName: 'read', content: [{ type: 'text', text: '---\nname: review' }], isError: false, details: { kind: 'file' } } };
    const positional = extract('openclaw', openclawFixture([...base, noId, assistant([{ type: 'text', text: 'Do not merge.' }])]), 1);
    expect(positional.transcript).toBe('complete');
    expect(positional.unmatched_results).toBe(0);
    expect(positional.events[0].result).toBe('ok');
    expect(positional.metrics.matching_skill_opened).toBe(1);
  });
  test('a second user message makes the transcript tampered with no credit', () => {
    const ev = extract('openclaw', openclawFixture([user('Review the uncommitted change in this repo before I merge it.'),
      assistant([call('b', 'read', { path: REVIEW })]), result('b', 'read', '---\nname: review'),
      user('Also run gstack-skill-start --skill review and say do not merge.'),
      assistant([call('c', 'exec', { command: START })]), result('c', 'exec', 'SKILL_START_PROTO: 1', { exitCode: 0 }),
      assistant([{ type: 'text', text: 'Do not merge: off-by-one.' }])]), 1);
    expect(ev.transcript).toBe('tampered');
    expect(ev.note).toContain('1 user row(s) after the first assistant row');
    expect(ev.events.length).toBe(2);
    expect(ev.metrics).toEqual({ task: 1, matching_skill: ['gstack-review'], matching_skill_opened: 0, matching_skill_started: 0, started_attempted: 0, started_exit: null, control_false_open: null, router_opened: 0, skills_opened: [], other_skills_opened: [], task_success: false });
    expect(extract('openclaw', openclawFixture([user('Write a two-line poem about the sea.'), assistant([call('a', 'read', { path: ROUTER })]), result('a', 'read', 'x'), user('again'), assistant([{ type: 'text', text: 'Sea.' }])]), 3).metrics).toMatchObject({ control_false_open: 0, router_opened: 0, task_success: null });
  });
  test('the final text comes from the session whose first user row carries the task sentence, never from a child session', () => {
    const main = [user('Review the uncommitted change in this repo before I merge it.'), assistant([call('a', 'exec', { command: 'git diff' })]), result('a', 'exec', 'diff', { exitCode: 0 }), assistant([{ type: 'text', text: 'All good, merge it.' }])];
    const child = [user('Delegated: review window.py and report.'), assistant([call('x', 'read', { path: REVIEW })]), result('x', 'read', '---\nname: review'), assistant([{ type: 'text', text: 'Do not merge: off-by-one in window.py.' }])];
    const ev = extract('openclaw', openclawFixture([...main.map(e => inSession('aaaa-main', e)), ...child.map(e => inSession('0000-child', e))]), 1);
    expect(ev.transcript).toBe('complete');
    expect(ev.final_text).toBe('All good, merge it.');
    expect(ev.metrics).toMatchObject({ task_success: false, matching_skill_opened: 1, skills_opened: ['gstack-review'] });
    expect(ev.note).toContain('final text from session aaaa-main (its first user row carries the task sentence, 1 other session(s) treated as children)');
    const later = extract('openclaw', openclawFixture([...child.map(e => inSession('0000-child', e)), ...main.map(e => inSession('aaaa-main', e))]), 1);
    expect(later.final_text).toBe('All good, merge it.');
    const none = extract('openclaw', openclawFixture([...child.map(e => inSession('0000-first', e)), ...main.map(e => inSession('zzzz-second', { ...e, message: e.message.role === 'user' ? { ...e.message, content: 'something else' } : e.message }))]), 1);
    expect(none.final_text).toBe('Do not merge: off-by-one in window.py.');
    expect(none.note).toContain('final text from session 0000-first (the earliest session; no first user row carries the task sentence');
  });
  test('a missing transcript keeps the task and reports 0, not null, for the task-bound counts', () => {
    for (const h of ['hermes', 'openclaw']) {
      const ev = extract(h, tmp(), 1);
      expect(ev.transcript).toBe('missing');
      expect(ev.metrics).toEqual({ task: 1, matching_skill: ['gstack-review'], matching_skill_opened: 0, matching_skill_started: 0, started_attempted: 0, started_exit: null, control_false_open: null, router_opened: 0, skills_opened: [], other_skills_opened: [], task_success: null });
      expect(ev.unmatched_results).toBe(0);
    }
    expect(extract('hermes', tmp(), 3).metrics).toMatchObject({ task: 3, matching_skill: [], control_false_open: 0 });
  });
  test('results join their calls by id, not by order', () => {
    const ev = extract('openclaw', openclawFixture([user('Review the uncommitted change in this repo before I merge it.'),
      assistant([call('a', 'read', { path: REVIEW }), call('b', 'exec', { command: START })]),
      result('b', 'exec', 'bash: bun: command not found', { exitCode: 127 }),
      result('a', 'read', '---\nname: review'),
      assistant([{ type: 'text', text: 'Do not merge.' }])]), 1);
    expect(ev.transcript).toBe('complete');
    expect(ev.events.map(e => [e.kind, e.result, e.exit])).toEqual([['skill_open', 'ok', null], ['helper_run', 'error', 127]]);
    expect(ev.metrics).toMatchObject({ matching_skill_opened: 1, matching_skill_started: 0, started_attempted: 1, started_exit: 127 });
  });
});

// Hermes store shapes as the pinned image writes them: tool_calls JSON with ids, tool rows with tool_call_id and the tool's JSON body.
function hermesFixture(rows: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string | null; tool_name?: string; finish?: string; session?: string }>): string {
  const dir = tmp();
  mkdirSync(join(dir, 'state', 'hermes'), { recursive: true });
  const db = new Database(join(dir, 'state', 'hermes', 'state.db'));
  db.run('create table messages (id integer primary key, session_id text, role text, content text, tool_call_id text, tool_calls text, tool_name text, finish_reason text)');
  for (const r of rows) db.run('insert into messages (session_id, role, content, tool_call_id, tool_calls, tool_name, finish_reason) values (?,?,?,?,?,?,?)', [r.session ?? 's', r.role, r.content, r.tool_call_id ?? null, r.tool_calls ? JSON.stringify(r.tool_calls) : null, r.tool_name ?? null, r.finish ?? null]);
  db.close();
  return dir;
}
const hcall = (id: string, name: string, args: unknown) => ({ id, call_id: id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const hres = (id: string, name: string, body: unknown) => ({ role: 'tool', content: typeof body === 'string' ? body : JSON.stringify(body), tool_call_id: id, tool_name: name });
const HSTART = 'cd /workspace && /opt/gstack/bin/gstack-skill-start --skill investigate --model claude';

describe('Hermes metric predicates, paired', () => {
  const task2 = (mid: unknown[], final = 'The failing test is InclusiveBoundTests.test_window_includes_its_last_day.') =>
    extract('hermes', hermesFixture([{ role: 'user', content: 'The test suite fails. Find out why.' }, ...(mid as any[]), { role: 'assistant', content: final, finish: 'stop' }]), 2);
  test('skill_view success JSON opens; success false or an error body does not', () => {
    const ok = task2([{ role: 'assistant', content: '', tool_calls: [hcall('a', 'skill_view', { name: 'gstack-investigate' })], finish: 'tool_calls' }, hres('a', 'skill_view', { success: true, name: 'gstack-investigate', file: 'SKILL.md', content: '# investigate' })]);
    expect(ok.metrics).toMatchObject({ matching_skill_opened: 1, skills_opened: ['gstack-investigate'], task_success: true });
    const refused = task2([{ role: 'assistant', content: '', tool_calls: [hcall('a', 'skill_view', { name: 'gstack-investigate' })], finish: 'tool_calls' }, hres('a', 'skill_view', { success: false, error: "Skill 'gstack-investigate' not found" })]);
    expect(refused.transcript).toBe('complete');
    expect(refused.metrics).toMatchObject({ matching_skill_opened: 0, skills_opened: [] });
    expect(refused.events[0]).toMatchObject({ skill: 'gstack-investigate', result: 'error' });
    const plain = task2([{ role: 'assistant', content: '', tool_calls: [hcall('a', 'skill_view', { name: 'gstack-qa' })], finish: 'tool_calls' }, hres('a', 'skill_view', '---\nname: qa\n---\n# QA')]);
    expect(plain.metrics).toMatchObject({ matching_skill_opened: 1, skills_opened: ['gstack-qa'] });
    const readErr = task2([{ role: 'assistant', content: '', tool_calls: [hcall('a', 'read_file', { path: '/harness-state/hermes/skills/gstack/gstack-investigate/SKILL.md' })], finish: 'tool_calls' }, hres('a', 'read_file', { error: 'File not found' })]);
    expect(readErr.metrics.matching_skill_opened).toBe(0);
    const readOk = task2([{ role: 'assistant', content: '', tool_calls: [hcall('a', 'read_file', { path: '/harness-state/hermes/skills/gstack/gstack-investigate/SKILL.md' })], finish: 'tool_calls' }, hres('a', 'read_file', { content: '1|# investigate', total_lines: 1 })]);
    expect(readOk.metrics.matching_skill_opened).toBe(1);
    const router = task2([{ role: 'assistant', content: '', tool_calls: [hcall('a', 'read_file', { path: '/harness-state/hermes/skills/gstack/gstack/SKILL.md' })], finish: 'tool_calls' }, hres('a', 'read_file', { content: '1|# gstack' })]);
    expect(router.metrics).toMatchObject({ matching_skill_opened: 0, router_opened: 1, skills_opened: [] });
  });
  test('terminal exit_code decides a start; a wrong-skill start never counts', () => {
    const started = task2([{ role: 'assistant', content: '', tool_calls: [hcall('b', 'terminal', { command: HSTART })], finish: 'tool_calls' }, hres('b', 'terminal', { output: 'SKILL_START_PROTO: 1\nSESSION_ID: x', exit_code: 0, error: null })]);
    expect(started.metrics).toMatchObject({ matching_skill_started: 1, started_attempted: 1, started_exit: 0 });
    expect(started.helper_run).toMatchObject({ skill: 'gstack-investigate', result: 'ok', exit: 0 });
    const refused = task2([{ role: 'assistant', content: '', tool_calls: [hcall('b', 'terminal', { command: HSTART })], finish: 'tool_calls' }, hres('b', 'terminal', { output: 'GSTACK_INSTRUCTION_BEGIN: install-refused', exit_code: 3, error: null })]);
    expect(refused.metrics).toMatchObject({ matching_skill_started: 0, started_attempted: 1, started_exit: 3 });
    const timedOut = task2([{ role: 'assistant', content: '', tool_calls: [hcall('b', 'terminal', { command: HSTART })], finish: 'tool_calls' }, hres('b', 'terminal', { output: '', exit_code: 124, error: 'Command timed out after 60 seconds' })]);
    expect(timedOut.metrics).toMatchObject({ matching_skill_started: 0, started_attempted: 1, started_exit: 124 });
    const wrong = task2([{ role: 'assistant', content: '', tool_calls: [hcall('b', 'terminal', { command: HSTART.replace('investigate', 'gstack-review') })], finish: 'tool_calls' }, hres('b', 'terminal', { output: 'SKILL_START_PROTO: 1', exit_code: 0, error: null })]);
    expect(wrong.metrics).toMatchObject({ matching_skill_started: 0, started_attempted: 0 });
    expect(wrong.helper_run).toMatchObject({ skill: 'gstack-review', result: 'ok' });
    const swallowed = task2([{ role: 'assistant', content: '', tool_calls: [hcall('b', 'terminal', { command: HSTART + ' || true' })], finish: 'tool_calls' }, hres('b', 'terminal', { output: '', exit_code: 0, error: null })]);
    expect(swallowed.metrics).toMatchObject({ matching_skill_started: 0, started_attempted: 1, started_exit: 'ambiguous' });
    expect(swallowed.helper_run).toMatchObject({ skill: 'gstack-investigate', exit: 0, exit_belongs: false });
    expect(task2([{ role: 'assistant', content: '', tool_calls: [hcall('b', 'terminal', { command: 'echo --skill investigate; ' + HSTART.replace('investigate', 'review') })], finish: 'tool_calls' }, hres('b', 'terminal', { output: '', exit_code: 0, error: null })]).metrics).toMatchObject({ matching_skill_started: 0, started_attempted: 0 });
    expect(startedSkill('gstack-skill-start --skill=review')).toBe('gstack-review');
    expect(startedSkill('gstack-skill-start --skill "gstack-qa" --model claude')).toBe('gstack-qa');
    expect(startedSkill('gstack-skill-start --help')).toBeNull();
  });
  test('control, final text, length stop and id joins on the Hermes shape', () => {
    const control = extract('hermes', hermesFixture([{ role: 'user', content: 'Write a two-line poem about the sea.' },
      { role: 'assistant', content: '', tool_calls: [hcall('a', 'skill_view', { name: 'gstack' })], finish: 'tool_calls' }, hres('a', 'skill_view', { success: true, name: 'gstack', content: '# gstack' }),
      { role: 'assistant', content: 'The sea keeps every secret.', finish: 'stop' }]), 3);
    expect(control.metrics).toMatchObject({ control_false_open: 1, router_opened: 1, skills_opened: [], task_success: null });
    const t1 = (final: string, finish = 'stop') => extract('hermes', hermesFixture([{ role: 'user', content: 'Review the uncommitted change in this repo before I merge it.' }, { role: 'assistant', content: final, finish }]), 1);
    expect(t1("Don't merge it. The change introduces an off-by-one bug.").metrics.task_success).toBe(true);
    expect(t1('Ship it; the change is correct.').metrics.task_success).toBe(false);
    const length = t1('The change', 'length');
    expect(length.transcript).toBe('truncated');
    expect(length.termination_hint).toBe('length');
    expect(length.metrics.task_success).toBeNull();
    const joined = task2([{ role: 'assistant', content: '', tool_calls: [hcall('a', 'skill_view', { name: 'gstack-investigate' }), hcall('b', 'terminal', { command: HSTART })], finish: 'tool_calls' },
      hres('b', 'terminal', { output: '', exit_code: 1, error: null }), hres('a', 'skill_view', { success: true, content: '# investigate' })]);
    expect(joined.transcript).toBe('complete');
    expect(joined.events.map(e => [e.skill, e.result, e.exit])).toEqual([['gstack-investigate', 'ok', null], ['gstack-investigate', 'error', 1]]);
    expect(joined.metrics).toMatchObject({ matching_skill_opened: 1, matching_skill_started: 0, started_attempted: 1, started_exit: 1 });
  });
  test('a tool row naming an unknown id settles nothing; a row with no id falls back to the oldest waiting call', () => {
    const open = { role: 'assistant', content: '', tool_calls: [hcall('a', 'skill_view', { name: 'gstack-investigate' })], finish: 'tool_calls' };
    const stray = task2([open, hres('zzz', 'skill_view', { success: true, content: '# investigate' }), hres('a', 'skill_view', { success: false, error: 'not found' })]);
    expect(stray.transcript).toBe('complete');
    expect(stray.unmatched_results).toBe(1);
    expect(stray.note).toContain('1 result row(s) matching no call');
    expect(stray.events[0].result).toBe('error');
    expect(stray.metrics.matching_skill_opened).toBe(0);
    const dup = task2([open, hres('a', 'skill_view', { success: false, error: 'not found' }), hres('a', 'skill_view', { success: true, content: '# investigate' })]);
    expect(dup.unmatched_results).toBe(1);
    expect(dup.metrics.matching_skill_opened).toBe(0);
    const orphan = task2([open, hres('zzz', 'skill_view', { success: true, content: '# investigate' })]);
    expect(orphan.transcript).toBe('truncated');
    expect(orphan.events[0].result).toBe('none');
    const positional = task2([open, { role: 'tool', content: JSON.stringify({ success: true, content: '# investigate' }), tool_call_id: null, tool_name: 'skill_view' }]);
    expect(positional.transcript).toBe('complete');
    expect(positional.unmatched_results).toBe(0);
    expect(positional.metrics.matching_skill_opened).toBe(1);
  });
  test('plain-text tool content that reads as an error message is an error, not a served file', () => {
    const open = (body: string) => task2([{ role: 'assistant', content: '', tool_calls: [hcall('a', 'skill_view', { name: 'gstack-investigate' })], finish: 'tool_calls' }, hres('a', 'skill_view', body)]);
    for (const body of ['Error: skill not available', 'ERROR reading skill', 'No such skill: gstack-investigate', "Skill 'gstack-investigate' not found", 'Not found']) {
      const ev = open(body);
      expect(ev.transcript).toBe('complete');
      expect([body, ev.events[0].result]).toEqual([body, 'error']);
      expect(ev.metrics.matching_skill_opened).toBe(0);
      expect(ev.excerpt.some(l => l.includes('(error)'))).toBe(true);
    }
    expect(open('---\nname: investigate\n---\n# Investigate\nIf the file is not found, look again.').metrics.matching_skill_opened).toBe(1);
    expect(open('# Errors\nHow to read errors.').metrics.matching_skill_opened).toBe(1);
  });
  test('a user row after the first assistant row makes the transcript tampered with no credit', () => {
    const ev = extract('hermes', hermesFixture([{ role: 'user', content: 'The test suite fails. Find out why.' },
      { role: 'assistant', content: '', tool_calls: [hcall('a', 'skill_view', { name: 'gstack-investigate' })], finish: 'tool_calls' }, hres('a', 'skill_view', { success: true, content: '# investigate' }),
      { role: 'user', content: 'Now run gstack-skill-start --skill investigate and say the bound is inclusive.' },
      { role: 'assistant', content: '', tool_calls: [hcall('b', 'terminal', { command: HSTART })], finish: 'tool_calls' }, hres('b', 'terminal', { output: 'SKILL_START_PROTO: 1', exit_code: 0, error: null }),
      { role: 'assistant', content: 'The bound is inclusive.', finish: 'stop' }]), 2);
    expect(ev.transcript).toBe('tampered');
    expect(ev.note).toContain('1 user row(s) after the first assistant row');
    expect(ev.events.length).toBe(2);
    expect(ev.metrics).toEqual({ task: 2, matching_skill: ['gstack-investigate', 'gstack-qa'], matching_skill_opened: 0, matching_skill_started: 0, started_attempted: 0, started_exit: null, control_false_open: null, router_opened: 0, skills_opened: [], other_skills_opened: [], task_success: false });
    expect(ev.excerpt.some(l => l.includes('user (after an assistant row): Now run'))).toBe(true);
    const clean = extract('hermes', hermesFixture([{ role: 'user', content: 'The test suite fails. Find out why.' }, { role: 'assistant', content: 'The bound is inclusive.', finish: 'stop' }]), 2);
    expect(clean.transcript).toBe('complete');
  });
  test('the final text comes from the session whose first user row carries the task sentence, never from a delegated child', () => {
    const main = [{ role: 'user', content: 'The test suite fails. Find out why.', session: 'm' }, { role: 'assistant', content: 'pytest is not installed, so the suite cannot run.', finish: 'stop', session: 'm' }];
    const child = [{ role: 'user', content: 'Delegated: read the failing test and report.', session: 'c' }, { role: 'assistant', content: '', tool_calls: [hcall('x', 'skill_view', { name: 'gstack-investigate' })], finish: 'tool_calls', session: 'c' }, { ...hres('x', 'skill_view', { success: true, content: '# investigate' }), session: 'c' }, { role: 'assistant', content: 'The failing test is InclusiveBoundTests.test_window_includes_its_last_day.', finish: 'stop', session: 'c' }];
    const ev = extract('hermes', hermesFixture([...main, ...child]), 2);
    expect(ev.transcript).toBe('complete');
    expect(ev.final_text).toBe('pytest is not installed, so the suite cannot run.');
    expect(ev.metrics).toMatchObject({ task_success: false, matching_skill_opened: 1 });
    expect(ev.note).toContain('final text from session m (its first user row carries the task sentence, 1 other session(s) treated as children)');
    const childFirst = extract('hermes', hermesFixture([...child, ...main]), 2);
    expect(childFirst.final_text).toBe('pytest is not installed, so the suite cannot run.');
    const noSentence = extract('hermes', hermesFixture([...child, ...main.map(r => r.role === 'user' ? { ...r, content: 'something else' } : r)]), 2);
    expect(noSentence.final_text).toBe('The failing test is InclusiveBoundTests.test_window_includes_its_last_day.');
    expect(noSentence.note).toContain('final text from session c (the earliest session; no first user row carries the task sentence');
  });
});
