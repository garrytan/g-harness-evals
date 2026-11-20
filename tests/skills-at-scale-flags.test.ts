// Keyless test of scripts/skills-at-scale/flags.ts and adjudicate-flags.ts (internal-task's decision, 2026-11-19): each flag on
// real-shaped request bodies (Anthropic Messages tool_use and tool_result blocks from Claude Code, Chat Completions tool
// calls from Pi, Hermes and OpenClaw, Anthropic Messages tool calls from QM), the full input and the cut result a reader gets, the flag file a results directory collects into flagged.jsonl with rates per arm and
// harness, and the two-reader settlement.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectFlags, flagTrial } from '../scripts/skills-at-scale/flags.ts';
import { settleFlags } from '../scripts/skills-at-scale/adjudicate-flags.ts';

const anthropic = (calls: [string, unknown][], results: string[]) => ({
  model: 'claude-opus-5-5', max_tokens: 32000, system: [{ type: 'text', text: 'You are Claude Code.' }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'make a pdf of the invoice' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Looking for the skill.' }, ...calls.map(([name, input], i) => ({ type: 'tool_use', id: 'toolu_0' + i, name, input }))] },
    { role: 'user', content: results.map((text, i) => ({ type: 'tool_result', tool_use_id: 'toolu_0' + i, content: [{ type: 'text', text }] })) },
  ],
});
const chat = (calls: [string, unknown][], results: string[]) => ({
  model: 'gpt-6.1-sol', stream: true,
  messages: [
    { role: 'system', content: 'You are a coding agent.' },
    { role: 'user', content: 'make a pdf of the invoice' },
    { role: 'assistant', content: null, tool_calls: calls.map(([name, input], i) => ({ id: 'call_' + i, type: 'function', function: { name, arguments: JSON.stringify(input) } })) },
    ...results.map((content, i) => ({ role: 'tool', tool_call_id: 'call_' + i, content })),
  ],
});
const dir = () => mkdtempSync(join(tmpdir(), 'flags-trial-'));
const flag = (harness: string, body: unknown) => flagTrial({ harness, catalog: ['pdf', 'invoice'], requests: [body], trialDir: dir() });

describe('flags.ts', () => {
  test('cd-joined: the opened-skill set differs with cd joining on and off', () => {
    const f = flag('claude-code', anthropic([['Bash', { command: 'cd /harness-state/claude/skills/pdf && cat SKILL.md', description: 'Read the pdf skill' }]], ['---\nname: pdf\ndescription: Make PDFs']));
    expect(f.flags).toEqual(['cd-joined']);
    expect(f.verdicts).toEqual({ cd_on: { contaminated: false, catalog_opened: ['pdf'] }, cd_off: { contaminated: false, catalog_opened: [] } });
    expect(f.calls.map((c) => [c.id, c.name, c.flags])).toEqual([['toolu_00', 'Bash', ['cd-joined']]]);
  });

  test('cd-joined: the clean-arm verdict differs with cd joining on and off', () => {
    const f = flag('pi', chat([['bash', { command: 'cd /home/user/.local/share/gstack/review && cat SKILL.md' }]], ['# review\nRun the review checklist.']));
    expect(f.flags).toEqual(['cd-joined']);
    expect([f.verdicts!.cd_on.contaminated, f.verdicts!.cd_off.contaminated]).toEqual([true, false]);
    expect(f.calls[0]!.id).toBe('call_0');
  });

  test('no flag when cd changes nothing: an absolute read after cd, and a plain read', () => {
    expect(flag('claude-code', anthropic([['Bash', { command: 'cd /tmp && cat /harness-state/claude/skills/pdf/SKILL.md' }], ['Read', { file_path: '/harness-state/claude/skills/invoice/SKILL.md' }]], ['---\nname: pdf', '---\nname: invoice'])).flags).toEqual([]);
  });

  test('failed-cd-probe: bash, sh and zsh failed-cd lines on a read joined to a cd', () => {
    const bash = flag('claude-code', anthropic([['Bash', { command: 'cd ~/.claude/skills/gstack && cat SKILL.md' }]], ['/bin/bash: line 1: cd: /root/.claude/skills/gstack: No such file or directory\ncat: SKILL.md: No such file or directory']));
    expect(bash.flags).toEqual(['cd-joined', 'failed-cd-probe']);
    expect(bash.verdicts!.cd_on.contaminated).toBe(true);
    const sh = flag('hermes', chat([['terminal', { command: 'cd /opt/notes && cat todo.md' }]], ["sh: 1: cd: can't cd to /opt/notes\ncat: todo.md: No such file or directory"]));
    expect(sh.flags).toEqual(['failed-cd-probe']);
    const zsh = flag('openclaw', chat([['exec', { command: 'cd /opt/notes && head -20 todo.md' }]], ['cd: no such file or directory: /opt/notes']));
    expect(zsh.flags).toEqual(['failed-cd-probe']);
    expect(flag('openclaw', chat([['exec', { command: 'cd /opt/notes && ls' }]], ['cd: no such file or directory: /opt/notes'])).flags).toEqual([]);
  });

  test('json-permission: a read whose JSON result carries a permission error in a decoded string', () => {
    const f = flag('openclaw', chat([['read', { path: '/workspace/skills/pdf/SKILL.md' }]], [JSON.stringify({ status: 'error', tool: 'read', error: "EACCES: permission denied, open '/workspace/skills/pdf/SKILL.md'" })]));
    expect(f.flags).toEqual(['json-permission']);
    const escaped = flag('hermes', chat([['read_file', { path: '/harness-state/hermes/skills/pdf/SKILL.md' }]], ['{"content": "", "error": "Permission\\u0020denied: /harness-state/hermes/skills/pdf/SKILL.md"}']));
    expect(escaped.flags).toEqual(['json-permission']);
    expect(flag('openclaw', chat([['read', { path: '/workspace/skills/pdf/SKILL.md' }]], [JSON.stringify({ content: '---\nname: pdf' })])).flags).toEqual([]);
    expect(flag('openclaw', chat([['web_search', { query: 'pdf' }]], [JSON.stringify({ error: 'Permission denied' })])).flags).toEqual([]);
  });

  test("errno13: a read whose result has Python's [Errno 13] Permission denied", () => {
    const f = flag('hermes', chat([['read_file', { path: '/harness-state/hermes/skills/pdf/SKILL.md' }]], ["Error reading file: [Errno 13] Permission denied: '/harness-state/hermes/skills/pdf/SKILL.md'"]));
    expect(f.flags).toEqual(['errno13']);
    expect(f.calls[0]!.result).toContain('[Errno 13]');
  });

  test('QM: an execute read joined to a cd, a failed-cd probe, and its skills read tool, which no cd changes', () => {
    const qm = (calls: [string, unknown][], results: string[]) => ({ ...anthropic(calls, results), model: 'claude-opus-5-5', tools: [{ name: 'execute' }, { name: 'skills' }, { name: 'files' }] });
    const joined = flagTrial({ harness: 'qm', catalog: ['careful'], trialDir: dir(), requests: [qm([['execute', { command: 'cd /root/workspace/.agent-skills/s1/ab12/careful && cat SKILL.md' }]], ['---\nname: careful\n---\nSlow down.\n[exit 0]'])] });
    expect(joined.flags).toEqual(['cd-joined']);
    expect(joined.verdicts).toEqual({ cd_on: { contaminated: false, catalog_opened: ['careful'] }, cd_off: { contaminated: false, catalog_opened: [] } });
    const probe = flagTrial({ harness: 'qm', catalog: ['careful'], trialDir: dir(), requests: [qm([['execute', { command: 'cd ~/.claude/skills/gstack && cat SKILL.md' }]], ["sh: 1: cd: can't cd to /root/.claude/skills/gstack\ncat: SKILL.md: No such file or directory\n[exit 1]"])] });
    expect(probe.flags).toEqual(['failed-cd-probe']);
    expect([probe.verdicts.cd_on.contaminated, probe.verdicts.cd_off.contaminated]).toEqual([false, false]);
    const skills = flagTrial({ harness: 'qm', catalog: ['careful'], trialDir: dir(), requests: [qm([['skills', { action: 'read', name: 'careful' }], ['skills', { action: 'list' }]], [JSON.stringify({ ok: false, error: 'EACCES: permission denied, open careful/SKILL.md' }), JSON.stringify({ error: 'permission denied' })])] });
    expect(skills.flags).toEqual(['json-permission']);
    expect(skills.calls.map((c) => [c.id, c.name])).toEqual([['toolu_00', 'skills']]);
    expect(() => flagTrial({ harness: 'gemini-cli', catalog: [], requests: [], trialDir: dir() })).toThrow('HE-SCALE-FLAGS-001');
  });

  test('a flagged call keeps its full input and up to 8,000 characters of its result, the cut marked', () => {
    const command = 'cd /opt/notes && cat todo.md ' + '#'.repeat(3000);
    const long = flag('hermes', chat([['terminal', { command, timeout: 60 }]], ["sh: 1: cd: can't cd to /opt/notes\n" + 'x'.repeat(10000)]));
    const c = long.calls[0]!;
    expect(c.input).toEqual({ command, timeout: 60 });
    expect(c.result_chars).toBe(10034);
    expect(c.result_cut).toBe(true);
    expect(c.result).toEndWith('\n[cut: 2034 more characters]');
    expect(c.result.length).toBe(8000 + '\n[cut: 2034 more characters]'.length);
    const short = flag('hermes', chat([['read_file', { path: '/harness-state/hermes/skills/pdf/SKILL.md' }]], ["[Errno 13] Permission denied: '/harness-state/hermes/skills/pdf/SKILL.md'"])).calls[0]!;
    expect([short.result_cut, short.result]).toEqual([false, "[Errno 13] Permission denied: '/harness-state/hermes/skills/pdf/SKILL.md'"]);
  });

  test('collectFlags: flagged.jsonl rows and the flag rate per arm and harness; a missing flag record is flagged', () => {
    const results = mkdtempSync(join(tmpdir(), 'flags-results-'));
    const cells = [{ id: 'cc-native-1500', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', skill_arm: 'native', rung: 1500 }, { id: 'pi-resolver-1500', harness: 'pi', model: 'openai:gpt-6.1-sol', skill_arm: 'resolver', rung: 1500 }];
    writeFileSync(join(results, 'manifest.json'), JSON.stringify({ run_id: 'run', cells }));
    const rows: string[] = [];
    const add = (cell: string, task: string, rec: unknown) => {
      const d = join(results, 'trials', cell, task, 'r1');
      mkdirSync(d, { recursive: true });
      if (rec) writeFileSync(join(d, 'skill-flags.json'), JSON.stringify(rec));
      rows.push(JSON.stringify({ trial_id: 'run/' + cell + '/' + task + '/r1', cell, task }));
    };
    const hit = flagTrial({ harness: 'claude-code', catalog: ['pdf'], requests: [anthropic([['Bash', { command: 'cd /harness-state/claude/skills/pdf && cat SKILL.md' }]], ['---\nname: pdf'])], trialDir: dir() });
    const clean = flagTrial({ harness: 'pi', catalog: ['pdf'], requests: [chat([['read', { path: '/harness-state/pi/skills/pdf/SKILL.md' }]], ['---'])], trialDir: dir() });
    add('cc-native-1500', 'l-s-1', hit); add('cc-native-1500', 'l-s-2', clean); add('pi-resolver-1500', 'l-s-1', clean); add('pi-resolver-1500', 'l-s-2', null);
    writeFileSync(join(results, 'trials.jsonl'), rows.join('\n') + '\n');
    const r = collectFlags(results);
    expect(r.flagged).toEqual([{ trial_id: 'run/cc-native-1500/l-s-1/r1', cell: 'cc-native-1500', arm: 'native', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', rung: 1500, flags: ['cd-joined'],
      call_ids: ['toolu_00'], trace_paths: ['trials/cc-native-1500/l-s-1/r1/skill-flags.json'], sources: ['proxy-requests'] },
      { trial_id: 'run/pi-resolver-1500/l-s-2/r1', cell: 'pi-resolver-1500', arm: 'resolver', harness: 'pi', model: 'openai:gpt-6.1-sol', rung: 1500, flags: ['missing-flag-record'],
        call_ids: [], trace_paths: ['trials/pi-resolver-1500/l-s-2/r1'], sources: [] }]);
    expect(r.missing).toEqual(['run/pi-resolver-1500/l-s-2/r1']);
    expect(r.summary.by_harness['claude-code']).toMatchObject({ trials: 2, flagged: 1, rate: 0.5, by_flag: { 'cd-joined': 1 } });
    expect(r.summary.by_harness.pi).toMatchObject({ trials: 2, with_flag_record: 1, missing_flag_record: 1, flagged: 1, rate: 0.5 });
    expect(r.summary.by_arm.resolver).toMatchObject({ flagged: 1, rate: 0.5 });
    expect(r.summary.by_arm.native).toMatchObject({ flagged: 1, rate: 0.5 });
  });
});

describe('adjudicate-flags.ts', () => {
  const flagged = [{ trial_id: 't1' }, { trial_id: 't2' }, { trial_id: 't3' }];
  test('two agreeing readers settle a trial; a disagreement is listed with what differs; one reader leaves it unread', () => {
    const r = settleFlags(flagged, [
      { trial_id: 't1', reader: 'a', contaminated: false, opened: ['pdf'] }, { trial_id: 't1', reader: 'b', contaminated: false, opened: ['pdf'] },
      { trial_id: 't2', reader: 'a', contaminated: true, opened: [] }, { trial_id: 't2', reader: 'b', contaminated: false, opened: ['pdf'] },
      { trial_id: 't3', reader: 'a', contaminated: false, opened: [] },
    ]);
    expect(r.settled).toEqual([{ trial_id: 't1', contaminated: false, opened: ['pdf'], readers: ['a', 'b'] }]);
    expect(r.disagreements.map((d) => [d.trial_id, d.differ])).toEqual([['t2', ['contaminated', 'opened']]]);
    expect(r.unread).toEqual([{ trial_id: 't3', readers: ['a'] }]);
    expect(r.summary.all_settled).toBe(false);
  });
  test('a verdict on an unflagged trial, a reader twice, or a malformed row is a problem', () => {
    const r = settleFlags([{ trial_id: 't1' }], [
      { trial_id: 't9', reader: 'a', contaminated: false, opened: [] },
      { trial_id: 't1', reader: 'a', contaminated: false, opened: [] }, { trial_id: 't1', reader: 'a', contaminated: true, opened: [] },
      { trial_id: 't1', reader: 'b', contaminated: 'no' as unknown as boolean, opened: [] },
    ]);
    expect(r.problems.length).toBe(3);
    expect(r.settled).toEqual([]);
    expect(settleFlags([{ trial_id: 't1' }], [{ trial_id: 't1', reader: 'a', contaminated: false, opened: ['b', 'a'] }, { trial_id: 't1', reader: 'b', contaminated: false, opened: ['a', 'b'] }]).summary.all_settled).toBe(true);
  });
});
