// Tests for the S1 gstack probe driver (harnesses/qm/gstack/s1-probe.ts, s1-count.ts, s1-fixture.ts) without Docker or a
// key. The counters get stored sessions shaped like QM b6786d67's (tool_call entries with payload.tool and the model's
// raw arguments in payload.wire.argumentsJson, tool_result entries with the same callId), and each rule has a case
// that a counter ignoring it gets wrong. The end-to-end dry run against the fake model needs Docker and the rig images;
// it is a command in harnesses/qm/gstack/README.md, not a test here.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countTurn, completeRead, opens, REQUESTS, SKILL_ROOT, toolCalls, type Entry, type StagedFile } from '../harnesses/qm/gstack/s1-count.ts';
import { buildFixture, FIXTURE_BRANCH, FIXTURE_TAG } from '../harnesses/qm/gstack/s1-fixture.ts';
import { ARM_IMAGES, DRY_RUN_ID, MODELS, RUN_ID, checkImageListing, designProblem, dryRunScript, latestAttempts, resumePlan, routerInPrompt, runStatus, sandboxProblem, sessionEvidence, soulProblems, summarize, systemOf, turnPlan } from '../harnesses/qm/gstack/s1-probe.ts';
import { upStack } from '../harnesses/qm/gstack/qm-stack.ts';

const path = (skill: string) => SKILL_ROOT + '/' + skill + '/SKILL.md';
const CAREFUL = 'line one of careful\n\nline two of careful\n';
const BIG = Array.from({ length: 40 }, (_, i) => 'investigate line ' + i).join('\n') + '\n';
const STAGED: StagedFile[] = [
  { sandbox_path: path('careful'), chars: CAREFUL.length, text: CAREFUL },
  { sandbox_path: path('investigate'), chars: BIG.length, text: BIG },
  { sandbox_path: path('review'), chars: 58767 },
  { sandbox_path: path('learn'), chars: 8351 },
  { sandbox_path: SKILL_ROOT + '/SKILL.md', chars: 100 },
];

/** A session built from [tool, arguments, result payload] steps, numbered the way QM stores them. */
function session(steps: Array<[string, Record<string, unknown>, Record<string, unknown> | null]>): Entry[] {
  const entries: Entry[] = [{ seq: 0, type: 'user', payload: { text: 'request' } }];
  steps.forEach(([tool, args, result], i) => {
    const callId = 'toolu_' + i;
    entries.push({ seq: entries.length, type: 'tool_call', payload: { tool, callId, wire: { argumentsJson: JSON.stringify(args) } } });
    if (result) entries.push({ seq: entries.length, type: 'tool_result', payload: { callId, tool, ...result } });
  });
  return entries;
}
const read = (p: string, result: Record<string, unknown>) => ['files', { action: 'read', path: p }, { path: p, action: 'read', found: true, ...result }] as [string, Record<string, unknown>, Record<string, unknown>];
const exec = (command: string, result = 'ok', code = 0) => ['execute', { command, purpose: 'Checking' }, { code, result }] as [string, Record<string, unknown>, Record<string, unknown>];
const req = (skill: string) => REQUESTS.find((r) => r.skill === skill)!;
const count = (skill: string, steps: Parameters<typeof session>[0], arm: 'gstack-router' | 'no-gstack' = 'gstack-router', routerInFirstPrompt: boolean | null = true) =>
  countTurn({ arm, request: req(skill), entries: session(steps), staged: STAGED, routerInFirstPrompt });

describe('s1-count: opens and complete reads', () => {
  test('a files read of the matched skill is a matched open, complete inline only when bytes equal the staged characters', () => {
    const whole = count('careful', [read(path('careful'), { bytes: CAREFUL.length, result: CAREFUL })]);
    expect([whole.open_any, whole.open_matched, whole.complete_read]).toEqual([true, true, 'inline']);
    const short = count('careful', [read(path('careful'), { bytes: CAREFUL.length - 1, result: CAREFUL.slice(1) })]);
    expect([short.open_matched, short.complete_read]).toEqual([true, null]);
  });

  test('a read QM answered with no file is not an open, and in gstack-router it is a fixture fault', () => {
    const c = count('careful', [['files', { action: 'read', path: path('careful') }, { path: path('careful'), action: 'read', found: false, isError: true, result: '[no such file: ' + path('careful') + ']' }]]);
    expect([c.open_any, c.faults]).toEqual([false, ['staged-file-missing']]);
    const n = count('careful', [['files', { action: 'read', path: path('careful') }, { path: path('careful'), action: 'read', found: false, result: '[no such file: x]' }]], 'no-gstack', false);
    expect(n.faults).toEqual([]);
  });

  test('another skill is an open but not a matched open; the root SKILL.md is neither', () => {
    const other = count('careful', [read(path('learn'), { bytes: 8351, result: 'x' })]);
    expect([other.open_any, other.open_matched]).toEqual([true, false]);
    const root = count('careful', [read(SKILL_ROOT + '/SKILL.md', { bytes: 100, result: 'x' })]);
    expect([root.open_any, root.root_reads]).toEqual([false, 1]);
  });

  test('an execute open needs cat, sed or head on the skill path and a clean exit; grep is not a read', () => {
    expect(count('careful', [exec('cat /root/workspace/gstack/careful/SKILL.md', CAREFUL)]).open_matched).toBe(true);
    expect(count('careful', [exec('cd /root/workspace && sed -n 1,80p gstack/careful/SKILL.md', CAREFUL)]).open_matched).toBe(true);
    expect(count('careful', [exec('grep -n careful /root/workspace/gstack/careful/SKILL.md')]).open_matched).toBe(false);
    expect(count('careful', [exec('cat /root/workspace/gstack/careful/SKILL.md', 'cat: no such file', 1)]).open_matched).toBe(false);
  });

  test('a cut read is complete only when later reads of the staged path or the parked copy deliver every line', () => {
    const lines = BIG.split('\n');
    const marker = '…[output cut: showing the first 100 and last 100 of ' + BIG.length + ' chars. The full output is in tool-output/md5/abc123; reading it with the files tool copies it onto the computer (kept 30 days)]…';
    const cut = read(path('investigate'), { bytes: BIG.length, output: { chars: BIG.length, shownChars: 200, blob: 'b' }, result: lines.slice(0, 5).join('\n') + '\n' + marker + '\n' + lines.slice(35).join('\n') });
    const parked = read('tool-output/md5/abc123', { bytes: 10, result: 'copied to /root/workspace/tool-output/abc123.txt' });
    const all = count('investigate', [cut, parked, exec('sed -n 1,20p /root/workspace/tool-output/abc123.txt', lines.slice(0, 20).join('\n')), exec('sed -n 20,40p /root/workspace/tool-output/abc123.txt', lines.slice(19, 40).join('\n'))]);
    expect([all.cut_reads, all.complete_read, all.read_after_cut]).toEqual([1, 'cut', true]);
    const gap = count('investigate', [cut, parked, exec('sed -n 1,20p /root/workspace/tool-output/abc123.txt', lines.slice(0, 20).join('\n'))]);
    expect([gap.cut_reads, gap.complete_read]).toEqual([1, null]);
    const unrelated = count('investigate', [cut, exec('sed -n 1,40p /tmp/other.txt', lines.join('\n'))]);
    expect(unrelated.complete_read).toBe(null);
  });

  test('opens() and completeRead() read the raw arguments of a call QM refused', () => {
    const calls = toolCalls(session([['execute', { command: 'cat /root/workspace/gstack/careful/SKILL.md', scope: 'personal' }, { result: 'Validation failed for tool "execute"' }]]));
    expect(calls[0]!.args.command).toBe('cat /root/workspace/gstack/careful/SKILL.md');
    expect(opens(calls)).toEqual([]);
    expect(completeRead(calls, STAGED[0]!)).toBe(null);
  });
});

describe('s1-count: starts', () => {
  test('the preamble counts only after a matched open, and only for the request\'s skill', () => {
    const open = read(path('investigate'), { bytes: BIG.length, result: 'x' });
    expect(count('investigate', [open, exec('gstack-skill-start --skill "investigate" --model "claude"', 'not found', 127)]).start_preamble).toBe(true);
    expect(count('investigate', [exec('gstack-skill-start --skill "investigate"', 'not found', 127), open]).start_preamble).toBe(false);
    expect(count('investigate', [open, exec('gstack-skill-start --skill "review"', 'not found', 127)]).start_preamble).toBe(false);
    expect(count('investigate', [exec('gstack-skill-start --skill "investigate"', 'not found', 127)]).start_preamble).toBe(false);
  });

  test('careful starts with the gstack-paths line; learn also with gstack-learnings-log', () => {
    const c = count('careful', [read(path('careful'), { bytes: CAREFUL.length, result: CAREFUL }), exec('GSTACK_STATE_ROOT=$(~/.claude/skills/gstack/bin/gstack-paths --get GSTACK_STATE_ROOT)', 'nope', 127)]);
    expect([c.start_preamble, c.start_first_step]).toEqual([true, null]);
    expect(count('learn', [read(path('learn'), { bytes: 8351, result: 'x' }), exec('gstack-learnings-log \'{"key":"flaky"}\'', 'nope', 127)]).start_preamble).toBe(true);
  });

  test('the first step is the skill\'s own command after the open: git log --oneline -20 -- for investigate, the base-branch probes for review', () => {
    const inv = read(path('investigate'), { bytes: BIG.length, result: 'x' });
    expect(count('investigate', [inv, exec('cd /root/workspace/repo && git log --oneline -20 --')]).start_first_step).toBe(true);
    expect(count('investigate', [exec('cd /root/workspace/repo && git log --oneline -20 --'), inv]).start_first_step).toBe(false);
    const rev = read(path('review'), { bytes: 58767, output: { chars: 58767, shownChars: 16384, blob: 'b' }, result: 'x' });
    expect(count('review', [rev, exec('git remote get-url origin', 'error: No such remote', 2)]).start_first_step).toBe(true);
    expect(count('review', [rev, exec('git log --oneline -20 --')]).start_first_step).toBe(false);
  });
});

describe('s1-count: progress, contamination and faults', () => {
  test('progress is the request\'s marker inside the fixture repository; request 3 has none', () => {
    expect(count('review', [exec('cd /root/workspace/repo && git diff main')], 'no-gstack', false).progress).toBe(true);
    expect(count('review', [exec('git -C repo diff main')], 'no-gstack', false).progress).toBe(true);
    expect(count('review', [exec('cd /tmp && git diff')], 'no-gstack', false).progress).toBe(false);
    expect(count('review', [exec('cd /root/workspace/repo && git log')], 'no-gstack', false).progress).toBe(false);
    expect(count('investigate', [exec('cd /root/workspace/repo && node test/login.test.js', 'AssertionError', 1)], 'no-gstack', false).progress).toBe(true);
    expect(count('document-release', [exec('cd /root/workspace/repo && git describe --tags --abbrev=0')], 'no-gstack', false).progress).toBe(true);
    expect(count('careful', [exec('cd /root/workspace/repo && git diff')], 'no-gstack', false).progress).toBe(null);
  });

  test('request 5 progresses on a memory write, not a memory search', () => {
    expect(count('learn', [['memory', { action: 'add', facts: [{ text: 'flaky retry' }] }, { added: 1, result: 'Remembered 1 fact.' }]], 'no-gstack', false).progress).toBe(true);
    expect(count('learn', [['memory', { action: 'search', query: 'retry' }, { result: 'none' }]], 'no-gstack', false).progress).toBe(false);
  });

  test('a no-gstack turn that names a gstack path or SKILL.md is contaminated; sigstack is not gstack', () => {
    const steps: Parameters<typeof session>[0] = [exec('ls ~/.claude/skills/gstack', 'No such file', 2)];
    const n = count('careful', steps, 'no-gstack', false);
    expect([n.audit.length, n.contaminated]).toEqual([1, true]);
    const g = count('careful', steps);
    expect([g.audit.length, g.contaminated]).toEqual([1, false]);
    expect(count('careful', [exec('grep -r sigstack /usr/include')], 'no-gstack', false).contaminated).toBe(false);
    expect(count('careful', [['skills', { action: 'read', name: 'careful/SKILL.md' }, { result: 'none' }]], 'no-gstack', false).contaminated).toBe(true);
  });

  test('a removed default sandbox and a router missing from the first prompt are fixture faults', () => {
    const noSandbox = exec('git status', 'this scope has no default sandbox; use sandbox list, create, set_default, then retry before reporting blocked', 1);
    expect(count('careful', [noSandbox], 'no-gstack', false).faults).toEqual(['no-default-sandbox']);
    expect(count('careful', [], 'gstack-router', false).faults).toEqual(['router-missing-from-system-prompt']);
    expect(count('careful', [], 'gstack-router', null).faults).toEqual(['router-prompt-unread']);
    expect(count('careful', [], 'no-gstack', false).faults).toEqual([]);
  });
});

describe('s1-probe: plan, preflight and dry-run script', () => {
  test('60 turns, 15 per arm and model: request by request, each repetition and model gstack-router then no-gstack', () => {
    const plan = turnPlan(3);
    expect(plan.length).toBe(60);
    expect(new Set(plan.map((t) => t.id)).size).toBe(60);
    expect(plan.slice(0, 5).map((t) => t.id)).toEqual(['s1-r1-k1-opus-gstack-router', 's1-r1-k1-opus-no-gstack', 's1-r1-k1-sol-gstack-router', 's1-r1-k1-sol-no-gstack', 's1-r1-k2-opus-gstack-router']);
    for (const model of ['opus', 'sol'] as const) for (const arm of ['gstack-router', 'no-gstack'] as const) expect(plan.filter((t) => t.model === model && t.arm === arm).length).toBe(15);
  });

  test('each model carries QM\'s housekeeping model of its own provider', () => {
    expect(MODELS).toEqual({ opus: { model: 'anthropic:claude-opus-5-5', housekeeping: 'anthropic:claude-haiku-5-5' }, sol: { model: 'openai:gpt-6.1-sol', housekeeping: 'openai:gpt-5.6-luna' } });
  });

  test('the requests are the preregistered ones', () => {
    const design = join(import.meta.dir, '..', 'docs', 'benchmarks', '2026-11-03-qm-s1-gstack-probe', 'design.json');
    expect(REQUESTS.map((r) => r.skill)).toEqual(['investigate', 'review', 'careful', 'document-release', 'learn']);
    if (existsSync(design)) expect(JSON.parse(readFileSync(design, 'utf8')).requests.map((r: { text: string }) => r.text)).toEqual(REQUESTS.map((r) => r.text));
  });

  const staged = [{ sandbox_path: path('careful'), sha256: 'a'.repeat(64) }, { sandbox_path: path('learn'), sha256: 'b'.repeat(64) }];
  const ok = ['- /root/workspace/gstack', '- /root/workspace/gstack/careful', 'a'.repeat(64) + ' ' + path('careful'), '- /root/workspace/gstack/learn', 'b'.repeat(64) + ' ' + path('learn'), 'c'.repeat(64) + ' /app/skills-seed/x/SKILL.md', '- /usr/lib/perl/bits/sigstack.ph'].join('\n');

  test('image preflight: gstack-router holds exactly the staged files, the others none', () => {
    expect(checkImageListing('gstack-router', ok, staged).problems).toEqual([]);
    expect(checkImageListing('gstack-router', ok.replace(path('learn'), '/tmp/learn.md'), staged).problems.join()).toMatch(/missing/);
    expect(checkImageListing('gstack-router', ok + '\n- /opt/gstack', staged).problems.join()).toMatch(/outside the staged files/);
    expect(checkImageListing('gstack-router', ok.replace('b'.repeat(64) + ' ', 'd'.repeat(64) + ' '), staged).problems.join()).toMatch(/differ/);
    const plain = 'c'.repeat(64) + ' /app/skills-seed/x/SKILL.md\n- /usr/lib/perl/bits/sigstack.ph';
    expect(checkImageListing('no-gstack', plain, staged)).toMatchObject({ problems: [], skill_files: 1 });
    expect(checkImageListing('no-gstack', plain + '\n' + 'a'.repeat(64) + ' /root/notes/SKILL.md', staged).problems.length).toBe(1);
    expect(checkImageListing('core', plain + '\nclaude-skills /root/.claude/skills', staged).problems.join()).toMatch(/claude/);
  });

  test('the system prompt is read from an Anthropic body\'s system or a Responses body\'s instructions and system items', () => {
    expect(systemOf({ system: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a\nb');
    expect(systemOf({ instructions: 'qm prompt', input: [{ role: 'developer', content: [{ type: 'input_text', text: 'org' }] }, { role: 'user', content: 'hi' }] })).toBe('qm prompt\norg');
    expect(systemOf({ input: [{ role: 'user', content: 'hi' }] })).toBe(null);
  });

  test('SOUL and system-prompt checks', () => {
    const router = '# gstack skills\n- **careful**: Read x\n';
    expect(soulProblems('gstack-router', router, router)).toEqual([]);
    expect(soulProblems('gstack-router', 'You are a helpful internal assistant', router).length).toBe(1);
    expect(soulProblems('no-gstack', 'You are a helpful internal assistant', router)).toEqual([]);
    expect(soulProblems('no-gstack', 'Use gstack for reviews', router).length).toBe(1);
    expect(routerInPrompt('# This session\n## Organization instructions\n' + router, router)).toBe(true);
    expect(routerInPrompt('# This session\n## Organization instructions\nYou are helpful', router)).toBe(false);
  });

  test('the dry-run model opens and starts a skill only in gstack-router, and only once the router line is in the prompt', () => {
    const g = dryRunScript('gstack-router', req('learn'));
    expect(g[0]).toMatchObject({ call: 'files', arguments: { path: path('learn') }, match: { system_contains: '- **learn**: ' } });
    for (const r of REQUESTS) for (const provider of ['anthropic', 'openai'] as const) expect(JSON.stringify(dryRunScript('no-gstack', r, provider))).not.toMatch(/gstack|SKILL\.md/);
    expect(dryRunScript('gstack-router', req('learn'), 'openai')[0]).toEqual({ call: 'files', arguments: { action: 'read', path: path('learn') } });
    expect(ARM_IMAGES['no-gstack']).not.toMatch(/gstack-/);
  });

  test('summarize leaves faulted turns out of the counts and names them', () => {
    const base = { run_id: 'x', model: 'anthropic:claude-opus-5-5', housekeeping: { model: 'anthropic:claude-haiku-5-5', requests: 1, usd: 0 }, rep: 1, attempt: 1, dry_run: true, started_at: '', ended_at: '', wall_ms: 10, images: { core: null, sandbox: '', sandbox_id: null }, soul: null, sandbox: null, turn: null, first_prompt: { system_chars: 1, router: true, gstack_word: true }, usage: null, reconcile: null };
    const c = (faults: string[]) => ({ ...count('careful', [read(path('careful'), { bytes: CAREFUL.length, result: CAREFUL })]), faults });
    const s = summarize([
      { ...base, turn_id: 'a', arm: 'gstack-router', request: 3, skill: 'careful', termination: 'ok', counts: c([]) },
      { ...base, turn_id: 'b', arm: 'gstack-router', request: 3, skill: 'careful', termination: 'ok', counts: c(['no-default-sandbox']) },
    ]);
    expect(s['opus/gstack-router']).toMatchObject({ turns: 2, counted: 1, matched_opens: 1, housekeeping: { requests: 2 }, excluded: [{ turn_id: 'b', faults: ['no-default-sandbox'] }] });
    expect(s['sol/gstack-router']).toMatchObject({ turns: 0, counted: 0 });
  });
});

describe('s1-fixture and the stack key check', () => {
  test('the fixture is the same repository on every build: pinned head, tag, feature branch checked out', () => {
    const a = buildFixture(join(mkdtempSync(join(tmpdir(), 's1-fixture-')), 'repo'));
    const b = buildFixture(join(mkdtempSync(join(tmpdir(), 's1-fixture-')), 'repo'));
    expect(a).toEqual(b);
    expect(a.head).toBe('9db8fa505db65ccd14f1f18a3ed6cd18da405d00');
    expect(a.refs).toContain('refs/heads/' + FIXTURE_BRANCH);
    expect(a.refs.some((r) => r.endsWith('refs/tags/' + FIXTURE_TAG))).toBe(true);
    expect(a.files).toBe(7);
  });

  test('upStack refuses a provider-shaped key and passes a trial token on to the image check', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 's1-stack-')), 'stack');
    await expect(upStack({ out, project: 'x', modelBaseUrl: 'http://127.0.0.1:1', modelKey: 'sk-ant-api03-not-a-dummy' })).rejects.toThrow(/never a provider key/);
    expect(existsSync(out)).toBe(false);
    await expect(upStack({ out, project: 'x', modelBaseUrl: 'http://127.0.0.1:1', modelKey: 'trial-token:t1.00', coreImage: 'harness-eval/qm:does-not-exist' })).rejects.toThrow(/prepare\.sh failed/);
  });
});

describe('s1-count and s1-probe: review round 2 (PR #254)', () => {
  test('an execute open needs a cat, sed or head segment that names the skill; a refused files read is no open', () => {
    expect(count('careful', [exec('cat /tmp/readme; test -f /root/workspace/gstack/careful/SKILL.md', 'readme')]).open_any).toBe(false);
    expect(count('careful', [exec('ls /tmp && cat /root/workspace/gstack/careful/SKILL.md | head -5', CAREFUL)]).open_matched).toBe(true);
    expect(count('careful', [['files', { action: 'read', path: path('careful') }, { result: 'Validation failed for tool "files"' }]]).open_any).toBe(false);
  });

  test('progress needs the call to have run: a refused execute or an error memory write is no progress, a failing test is', () => {
    expect(count('review', [['execute', { command: 'cd /root/workspace/repo && git diff main' }, { result: 'Validation failed for tool "execute"' }]], 'no-gstack', false).progress).toBe(false);
    expect(count('learn', [['memory', { action: 'add', facts: [{ text: 'flaky retry' }] }, { isError: true, result: 'permission denied' }]], 'no-gstack', false).progress).toBe(false);
    expect(count('investigate', [exec('cd /root/workspace/repo && node test/login.test.js', 'AssertionError', 1)], 'no-gstack', false).progress).toBe(true);
  });

  test('a restart resumes without rerunning recorded turns; a repair runs the next attempt and the summary keeps the latest', () => {
    const plan = turnPlan(3).slice(0, 3);
    const prior = [{ run_id: RUN_ID, turn_id: plan[0]!.id, attempt: 1 }, { run_id: RUN_ID, turn_id: plan[1]!.id, attempt: 1 }, { run_id: RUN_ID, turn_id: plan[0]!.id + '-r2', attempt: 2 }];
    expect(resumePlan(plan, prior, RUN_ID, false).todo.map((t) => [t.turn.id, t.attempt])).toEqual([[plan[2]!.id, 1]]);
    expect(resumePlan([plan[0]!], prior, RUN_ID, true).todo.map((t) => [t.turn.id, t.attempt])).toEqual([[plan[0]!.id, 3]]);
    const { latest, superseded } = latestAttempts([...prior, { run_id: RUN_ID, turn_id: plan[0]!.id + '-r3', attempt: 3 }]);
    expect(latest.map((r) => r.turn_id).sort()).toEqual([plan[0]!.id + '-r3', plan[1]!.id].sort());
    expect(superseded).toEqual([plan[0]!.id, plan[0]!.id + '-r2']);
  });

  test('a results directory holding another run id\'s records (a dry run beside a paid run) is refused', () => {
    const r = resumePlan(turnPlan(1), [{ run_id: DRY_RUN_ID, turn_id: turnPlan(1)[0]!.id, attempt: 1 }], RUN_ID, false);
    expect([r.todo.length, r.problem]).toEqual([0, expect.stringContaining(DRY_RUN_ID)]);
  });

  test('a stored session is evidence only from a 200 answer with an entries array', () => {
    expect(sessionEvidence({ http: 500, body: { error: 'boom' } })).toEqual({ error: expect.stringContaining('500') });
    expect(sessionEvidence({ http: 200, body: 'socket hang up' })).toHaveProperty('error');
    expect(sessionEvidence({ http: 200, body: { entries: [] } })).toEqual({ entries: [] });
  });

  test('a cap stop, a planned turn without a record or every turn failing leaves the run incomplete', () => {
    const ids = ['a', 'b'];
    expect(runStatus(ids, [{ turn_id: 'a', attempt: 1, termination: 'ok' }, { turn_id: 'b', attempt: 1, termination: 'turn_error' }]).complete).toBe(true);
    expect(runStatus(ids, [{ turn_id: 'a', attempt: 1, termination: 'cap_stop' }])).toMatchObject({ complete: false, cap_stop: true, missing: ['b'] });
    expect(runStatus(ids, [{ turn_id: 'a', attempt: 1, termination: 'stack_error' }, { turn_id: 'b-r2', attempt: 2, termination: 'evidence_error' }]).complete).toBe(false);
  });

  test('a sandbox QM did not create or select stops the turn', () => {
    expect(sandboxProblem({ http: 500, body: null }, { http: 200 })).toMatch(/create answered 500/);
    expect(sandboxProblem({ http: 200, body: { id: 'sb1' } }, { http: 404 })).toMatch(/default answered 404/);
    expect(sandboxProblem({ http: 201, body: { id: 'sb1' } }, { http: 200 })).toBe(null);
  });

  test('a paid run refuses to start without the merged design.json; a dry run goes on', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 's1-design-')), 'design.json');
    expect(designProblem(false, missing)).toMatch(/needs the merged preregistration/);
    expect(designProblem(true, missing)).toBe(null);
  });
});
