// Tool-using judge and labeller (scripts/review-bugs/tool-judge.ts) for the review-real-bugs eval, stage 2. Keyless: a
// small git repository built here, and fake transports in the Anthropic Messages and OpenAI Responses shapes.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXTRA_TURNS, MAX_EXTRA_TURNS, parseJudge, promptFor, readOnce, RepoView, requestBody, runSession, SUBMIT, TOOL_BUDGET, toolSpecs, validateRuling, type JudgeItem, type Transport } from '../../scripts/review-bugs/tool-judge.ts';

const tmp = mkdtempSync(join(tmpdir(), 'tool-judge-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const repo = join(tmp, 'repo');
mkdirSync(join(repo, 'pkg'), { recursive: true });
const g = (...a: string[]) => { const r = spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
g('init', '-q', '-b', 'main');
writeFileSync(join(repo, 'pkg', 'calc.py'), 'def ratio(a, b):\n    return a / b\n');
g('add', '.'); g('commit', '-q', '-m', 'base');
const base = g('rev-parse', 'HEAD');
g('checkout', '-q', '-b', 'pr');
writeFileSync(join(repo, 'pkg', 'calc.py'), 'def ratio(a, b):\n    if b == 0:\n        return 0\n    return a / b\n\ndef mean(xs):\n    return sum(xs) / len(xs)\n');
g('add', '.'); g('commit', '-q', '-m', 'add mean');
const head = g('rev-parse', 'HEAD');
writeFileSync(join(repo, 'pkg', 'calc.py'), 'def ratio(a, b):\n    if b == 0:\n        return 0\n    return a / b\n\ndef mean(xs):\n    return sum(xs) / len(xs) if xs else 0.0\n');
g('add', '.'); g('commit', '-q', '-m', 'fix empty mean');
const fix = g('rev-parse', 'HEAD');
g('checkout', '-q', 'main'); g('merge', '-q', '--no-ff', '-m', 'merge pr', 'pr');
writeFileSync(join(repo, 'pkg', 'later.py'), 'LATER_ONLY_MARKER = 1\n');
g('add', '.'); g('commit', '-q', '-m', 'later work');
const tip = g('rev-parse', 'HEAD');

const item: JudgeItem = { item: 'u1-F1', unit: 'acme/calc#7@' + head.slice(0, 12), git_dir: join(repo, '.git'), head, merge_base: base, pr_text: '# Add mean\n\nAdds mean().\n',
  finding: { path: 'pkg/calc.py', line: 7, text: 'mean([]) divides by zero.' }, known_informational: [], later: { tip, fixes: [fix], bugs: ['pkg/calc.py:7: mean of an empty list raises ZeroDivisionError.'] } };
const judgeView = new RepoView(item, 'judge');
const labView = new RepoView(item, 'labeller');

describe('the read-only repository view', () => {
  test('a judge reads the head tree only: files, lines, grep and the PR diff', () => {
    expect(judgeView.listDir('')).toBe('pkg/');
    expect(judgeView.listDir('pkg')).toBe('calc.py');
    expect(judgeView.readFile('pkg/calc.py', 6, 7)).toBe('     6  def mean(xs):\n     7      return sum(xs) / len(xs)\n[pkg/calc.py lines 6-7 of 7]');
    expect(judgeView.grep('LATER_ONLY_MARKER', '')).toBe('no match');
    expect(judgeView.grep('def ', 'pkg')).toBe('pkg/calc.py:1:def ratio(a, b):\npkg/calc.py:6:def mean(xs):');
    expect(judgeView.prDiff('pkg/calc.py')).toContain('+def mean(xs):');
    expect(judgeView.readFile('pkg/later.py', null, null)).toMatch(/^no file/);
  });
  test('a judge gets no later tree, log or commit', () => {
    expect(judgeView.readFile('pkg/calc.py', null, null, 'later')).toMatch(/at must be "head"$/);
    expect(judgeView.log('pkg/calc.py')).toBe('no such tool');
    expect(judgeView.showCommit(fix, '')).toBe('no such tool');
  });
  test('paths that escape or look like options are refused', () => {
    for (const p of ['../x', '/etc/passwd', '-x', 'a/../../b', 'HEAD:x']) expect(judgeView.readFile(p, null, null)).toMatch(/relative to the repository root/);
  });
  test('a labeller reads the later tree, the log and fix or later commits only', () => {
    expect(labView.readFile('pkg/later.py', null, null, 'later')).toContain('LATER_ONLY_MARKER');
    expect(labView.log('pkg/calc.py')).toContain(fix);
    expect(labView.showCommit(fix.slice(0, 10), 'pkg/calc.py')).toContain('if xs else 0.0');
    expect(labView.showCommit(tip, '')).toContain('later work');
    expect(labView.showCommit(base, '')).toMatch(/takes a fix commit or a later commit/);
  });
});

describe('prompts and tools', () => {
  test('the judge prompt has the PR, the finding and the diff, and nothing from after the head', () => {
    const p = promptFor(judgeView, 'BRIEF');
    expect(p.startsWith('BRIEF\n\n# The pull request\n\n# Add mean')).toBe(true);
    expect(p).toContain('Path: pkg/calc.py, line 7');
    expect(p).toContain('+def mean(xs):');
    expect(p).not.toContain(fix);
    expect(p).not.toContain('# The fixes');
    expect(p).toContain('Never rule known-informational');
  });
  test('the labeller prompt adds the known bugs and the fix diff', () => {
    const p = promptFor(labView, 'BRIEF');
    expect(p).toContain('mean of an empty list raises ZeroDivisionError');
    expect(p).toContain('### Fix commit ' + fix);
  });
  test('judges get four read tools and submit; labellers add log and show_commit; every schema is strict', () => {
    expect(toolSpecs('judge').map((t) => t.name)).toEqual(['list_dir', 'read_file', 'grep', 'pr_diff', 'submit_ruling']);
    expect(toolSpecs('labeller').map((t) => t.name)).toEqual(['list_dir', 'read_file', 'grep', 'pr_diff', 'log', 'show_commit', 'submit_ruling']);
    for (const t of toolSpecs('labeller')) {
      const p = t.parameters as { properties: object; required: string[]; additionalProperties: boolean };
      expect(p.required).toEqual(Object.keys(p.properties));
      expect(p.additionalProperties).toBe(false);
    }
  });
  test('request settings: Anthropic with no sampling or thinking field and two cache breakpoints; OpenAI stateless and strict', () => {
    const a = requestBody(parseJudge('anthropic:claude-opus-5-5'), 'P', [{ role: 'assistant', content: [] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'r' }] }], toolSpecs('judge'), 'k') as any;
    expect(a.temperature).toBeUndefined();
    expect(a.thinking).toBeUndefined();
    expect(a.tool_choice).toEqual({ type: 'auto' });
    expect(a.max_tokens).toBe(16000);
    expect(JSON.stringify(a.messages).match(/cache_control/g)!.length).toBe(2);
    expect(a.tools.find((t: any) => t.name === 'submit_ruling').strict).toBe(true);
    const o = requestBody(parseJudge('openai:gpt-6-astra'), 'P', [], toolSpecs('judge'), 'k') as any;
    expect(o).toMatchObject({ store: false, include: ['reasoning.encrypted_content'], reasoning: { effort: 'medium' }, max_output_tokens: 16000, prompt_cache_key: 'k', tool_choice: 'auto' });
    expect(o.tools.every((t: any) => t.strict === true && t.type === 'function')).toBe(true);
  });
  test('a ruling is checked: the label set, known-informational only with a case, a defect needs a trigger', () => {
    const ok = { ruling: 'not-defect', test: 'contradicted', lines: ['pkg/calc.py:2-3'], trigger: null, breaks: null, reason: 'guarded' };
    expect(validateRuling(ok, item)).toMatchObject({ ruling: 'not-defect' });
    expect(validateRuling({ ...ok, ruling: 'maybe' }, item)).toMatch(/ruling must be/);
    expect(validateRuling({ ...ok, ruling: 'known-informational', test: 'known' }, item)).toMatch(/lists no known informational/);
    expect(validateRuling({ ...ok, ruling: 'known-informational', test: 'known' }, { ...item, known_informational: [{ id: 'I1' }] })).toMatchObject({ ruling: 'known-informational' });
    expect(validateRuling({ ...ok, ruling: 'defect', test: 'defect' }, item)).toMatch(/trigger and breaks/);
  });
});

const ok = (body: unknown) => ({ status: 200, text: JSON.stringify(body) });
const submit = { ruling: 'defect', test: 'defect', lines: ['pkg/calc.py:7'], trigger: 'mean([])', breaks: 'production', reason: 'Divides by len 0.' };
function scripted(replies: Array<(body: any) => { status: number; text: string }>): Transport & { bodies: any[] } {
  const bodies: any[] = [];
  const t = (async (_j: unknown, body: any) => { bodies.push(structuredClone(body)); return replies[Math.min(bodies.length - 1, replies.length - 1)]!(body); }) as Transport & { bodies: any[] };
  t.bodies = bodies;
  return t;
}

describe('sessions', () => {
  const openai = parseJudge('openai:gpt-6-astra');
  const anthropic = parseJudge('anthropic:claude-opus-5-5');
  const fc = (name: string, args: object, id = 'c1') => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
  const tu = (name: string, input: object, id = 't1') => ({ type: 'tool_use', id, name, input });
  test('OpenAI: a tool call, then submit_ruling; outputs and reasoning are carried to the next turn', async () => {
    const t = scripted([
      () => ok({ output: [{ type: 'reasoning', encrypted_content: 'E' }, fc('read_file', { path: 'pkg/calc.py', start_line: 6, end_line: 7 })], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10 } }),
      () => ok({ output: [fc('submit_ruling', submit, 'c2')], usage: { input_tokens: 150, input_tokens_details: { cached_tokens: 100 }, output_tokens: 20 } }),
    ]);
    const r = await runSession(judgeView, openai, 'P', t);
    expect(r).toMatchObject({ outcome: 'ruled', tool_calls: 1, turns: 2, usage: { input: 250, cached: 100, output: 30 } });
    expect(r.ruled!.ruling).toBe('defect');
    const second = t.bodies[1].input;
    expect(second[1]).toEqual({ type: 'reasoning', encrypted_content: 'E' });
    expect(second.at(-1)).toMatchObject({ type: 'function_call_output', call_id: 'c1' });
    expect(second.at(-1).output).toContain('def mean(xs):');
  });
  test('Anthropic: an invalid ruling gets its reason back and the session goes on', async () => {
    const t = scripted([
      () => ok({ content: [{ type: 'text', text: 'Looking.' }, tu('grep', { pattern: 'len\\(', path: '' })], stop_reason: 'tool_use', usage: { input_tokens: 50, cache_read_input_tokens: 0, output_tokens: 5 } }),
      () => ok({ content: [tu('submit_ruling', { ...submit, ruling: 'known-informational', test: 'known' }, 't2')], stop_reason: 'tool_use', usage: { input_tokens: 5, cache_read_input_tokens: 50, output_tokens: 5 } }),
      () => ok({ content: [tu('submit_ruling', submit, 't3')], stop_reason: 'tool_use', usage: { input_tokens: 5, cache_read_input_tokens: 60, output_tokens: 5 } }),
    ]);
    const r = await runSession(judgeView, anthropic, 'P', t);
    expect(r).toMatchObject({ outcome: 'ruled', tool_calls: 1, turns: 3 });
    const last = t.bodies[2].messages.at(-1);
    expect(last.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't2' });
    expect(last.content[0].content).toMatch(/^Not accepted: this unit lists no known informational case/);
  });
  test('the tool budget: past it only submit_ruling is offered, and no ruling within the extra turns is unanswered', async () => {
    let n = 0;
    const t = scripted([() => ok({ output: [fc('list_dir', { path: '' }, 'c' + (++n))], usage: { input_tokens: 1, output_tokens: 1 } })]);
    const r = await runSession(judgeView, openai, 'P', t);
    expect(r.outcome).toBe('unanswered');
    expect(r.tool_calls).toBe(TOOL_BUDGET.judge);
    expect(t.bodies.length).toBe(TOOL_BUDGET.judge + EXTRA_TURNS);
    expect(t.bodies.at(-1).tools.map((x: any) => x.name)).toEqual([SUBMIT.name]);
    expect(t.bodies[TOOL_BUDGET.judge - 1].tools.length).toBe(5);
  });
  test('refusals and filter stops are results, never retried; an unanswered or failed read is asked once more', async () => {
    const cyber = scripted([() => ({ status: 400, text: '{"error":{"code":"cyber_policy"}}' })]);
    expect(await readOnce(judgeView, openai, 'P', cyber)).toMatchObject({ outcome: 'refused', attempts: 1 });
    const empty = scripted([() => ok({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 0 } })]);
    expect(await readOnce(judgeView, anthropic, 'P', empty)).toMatchObject({ outcome: 'filtered', attempts: 1 });
    const stop = scripted([() => ok({ content: [], stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 3 } })]);
    expect((await readOnce(judgeView, anthropic, 'P', stop)).outcome).toBe('filtered');
    const flaky = scripted([() => ({ status: 500, text: 'upstream' }), () => ok({ output: [fc('submit_ruling', submit)], usage: { input_tokens: 1, output_tokens: 1 } })]);
    const r = await readOnce(judgeView, openai, 'P', flaky);
    expect(r).toMatchObject({ outcome: 'ruled', attempts: 2 });
    expect(r.note).toMatch(/^retried after: HTTP 500/);
  });
  test('a retried read reports both attempts\' tokens, turns and tool calls', async () => {
    const talk = () => ok({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Thinking.' }] }], usage: { input_tokens: 100, output_tokens: 1 } });
    const t = scripted([talk, talk, talk, () => ok({ output: [fc('submit_ruling', submit)], usage: { input_tokens: 100, output_tokens: 1 } })]);
    const r = await readOnce(judgeView, openai, 'P', t);
    expect(r).toMatchObject({ outcome: 'ruled', attempts: 2, turns: 4, usage: { input: 400, output: 4 } });
    expect(r.calls.map((c) => c.name)).toEqual([SUBMIT.name]);
  });
  test('rejected submit_ruling calls end the session at the turn cap instead of looping', async () => {
    const t = scripted([() => { if (t.bodies.length > 100) throw new Error('still looping after 100 turns'); return ok({ output: [fc('submit_ruling', { ...submit, ruling: 'known-informational', test: 'known' }, 'c' + t.bodies.length)], usage: { input_tokens: 1, output_tokens: 1 } }); }]);
    const r = await runSession(judgeView, openai, 'P', t);
    expect(r.outcome).toBe('unanswered');
    expect(r.note).toMatch(/no accepted submit_ruling within/);
    expect(t.bodies.length).toBe(TOOL_BUDGET.judge + MAX_EXTRA_TURNS);
  });
  test('an OpenAI content-filter stop ends the read as filtered, even with a ruling in the same turn', async () => {
    const t = scripted([() => ok({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [fc('submit_ruling', submit)], usage: { input_tokens: 10, output_tokens: 5 } })]);
    const r = await readOnce(judgeView, openai, 'P', t);
    expect(r).toMatchObject({ outcome: 'filtered', ruled: null, attempts: 1 });
    expect(t.bodies.length).toBe(1);
  });
  test('a reply with no tool call is nudged twice, then unanswered', async () => {
    const t = scripted([() => ok({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'It is a defect.' }] }], usage: { input_tokens: 1, output_tokens: 1 } })]);
    const r = await runSession(judgeView, openai, 'P', t);
    expect(r.outcome).toBe('unanswered');
    expect(t.bodies.length).toBe(3);
    expect(t.bodies[1].input.at(-1)).toEqual({ role: 'user', content: [{ type: 'input_text', text: 'Call submit_ruling now with your ruling.' }] });
  });
});
