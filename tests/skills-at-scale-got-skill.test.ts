import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gotSkill, shellReads, type Harness } from '../scripts/skill-resolver/got-skill.ts';
import { gotSkillRecord, gstackReads } from '../runner/trial/skill-requests.ts';

const anthropic = (calls: [string, unknown][], results: string[] = []) => ({
  messages: [
    { role: 'assistant', content: calls.map(([name, input], i) => ({ type: 'tool_use', id: 'c' + i, name, input })) },
    { role: 'user', content: results.map((text, i) => ({ type: 'tool_result', tool_use_id: 'c' + i, content: text })) },
  ],
});
const chat = (calls: [string, unknown][], results: string[] = []) => ({
  messages: [
    { role: 'user', content: 'make a pdf' },
    { role: 'assistant', content: null, tool_calls: calls.map(([name, input], i) => ({ id: 'c' + i, type: 'function', function: { name, arguments: JSON.stringify(input) } })) },
    ...results.map((content, i) => ({ role: 'tool', tool_call_id: 'c' + i, content })),
  ],
});
const got = (harness: Harness, body: unknown) => gotSkill({ harness, catalog: ['pdf'], requests: [body] });

describe('got-skill: OpenClaw deferred skills_read by id', () => {
  test('a tool_call that names skills_read in id opens the skill, with or without a namespace prefix', () => {
    for (const id of ['skills_read', 'openclaw:core:skills_read']) {
      const body = anthropic([['tool_call', { id, args: { name: 'pdf' } }]]);
      expect([id, got('openclaw', body).catalog_opened]).toEqual([id, ['pdf']]);
    }
  });
  test('a tool_call to any other id opens nothing', () => {
    expect(got('openclaw', anthropic([['tool_call', { id: 'web_search', args: { query: 'pdf' } }]])).catalog_opened).toEqual([]);
  });
});

describe('got-skill: Chat Completions request bodies', () => {
  test('an assistant tool_calls read opens the skill on OpenClaw, Hermes and Pi', () => {
    const P = '/harness-state/x/skills/pdf/SKILL.md';
    expect(got('openclaw', chat([['read', { path: P }]], ['---\nname: pdf'])).catalog_opened).toEqual(['pdf']);
    expect(got('hermes', chat([['read_file', { path: P }]], ['---\nname: pdf'])).catalog_opened).toEqual(['pdf']);
    expect(got('pi', chat([['read', { path: P }]], ['---\nname: pdf'])).catalog_opened).toEqual(['pdf']);
  });
  test('a tool message that says the file is missing marks the open failed', () => {
    const r = got('pi', chat([['read', { path: '/nope/pdf/SKILL.md' }]], ['ENOENT: no such file or directory']));
    expect(r.catalog_opened).toEqual([]);
    expect(r.failed.map((f) => f.skill)).toEqual(['pdf']);
  });
});

describe('got-skill: Pi', () => {
  const P = '/harness-state/pi/skills/pdf/SKILL.md';
  test('its read tool and a reader in its bash tool open a skill', () => {
    expect(got('pi', anthropic([['read', { path: P }]])).catalog_opened).toEqual(['pdf']);
    expect(got('pi', anthropic([['bash', { command: 'sed -n 1,80p ' + P }]])).catalog_opened).toEqual(['pdf']);
  });
  test('a write, an edit, an echo or a grep naming the path opens nothing', () => {
    const calls: [string, unknown][] = [['write', { path: P, content: 'x' }], ['edit', { path: P, oldText: 'a', newText: 'b' }], ['bash', { command: 'echo ' + P }], ['bash', { command: 'grep -n name ' + P }]];
    expect(got('pi', anthropic(calls)).catalog_opened).toEqual([]);
  });
  test('the runner records a Pi trial', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sas-pi-'));
    expect(gotSkillRecord('pi', ['pdf'], [anthropic([['read', { path: P }]], ['---'])], dir).opened).toEqual(['pdf']);
  });
});

describe('got-skill: a relative read after cd', () => {
  test('cd into a skill folder, then cat SKILL.md, opens that skill', () => {
    expect(shellReads('cd /workspace/skills/pdf && cat SKILL.md')).toEqual(['pdf']);
    expect(got('openclaw', anthropic([['exec', { command: 'cd /workspace/skills/pdf && cat SKILL.md' }]])).catalog_opened).toEqual(['pdf']);
  });
  test('an absolute read after cd is unchanged, and a later cd moves the base', () => {
    expect(shellReads('cd /tmp && cat /workspace/skills/pdf/SKILL.md')).toEqual(['pdf']);
    expect(shellReads('cd /workspace/skills && cd pdf && head -5 SKILL.md')).toEqual(['pdf']);
  });
});

describe('clean-arm count: failed opens and relative paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sas-clean-'));
  const preamble = '~/.claude/skills/gstack/review/sections/preamble.md';
  test('a read refused with Permission denied or EACCES is not a read', () => {
    for (const msg of ['cat: ' + preamble + ': Permission denied', "EACCES: permission denied, open '" + preamble + "'"]) {
      const r = gstackReads('claude-code', [anthropic([['Bash', { command: 'cat ' + preamble }]], [msg])], dir);
      expect([msg, r.contaminated]).toEqual([msg, false]);
    }
  });
  test('a read that succeeds outside the catalog copy still counts', () => {
    expect(gstackReads('claude-code', [anthropic([['Bash', { command: 'cat ' + preamble }]], ['# preamble'])], dir).contaminated).toBe(true);
  });
  test('a relative read resolves against an earlier cd in the same command', () => {
    const inCatalog = gstackReads('claude-code', [anthropic([['Bash', { command: 'cd /harness-state/claude/skills/gstack/review && cat SKILL.md' }]], ['# review'])], dir);
    const outside = gstackReads('claude-code', [anthropic([['Bash', { command: 'cd /home/user/.local/share/gstack/review && cat SKILL.md' }]], ['# review'])], dir);
    expect([inCatalog.contaminated, outside.contaminated]).toEqual([false, true]);
  });
  test('Pi reads are counted, and its catalog copy is not outside', () => {
    const inCatalog = gstackReads('pi', [anthropic([['read', { path: '/harness-state/pi/skills/gstack/review/SKILL.md' }]], ['# review'])], dir);
    const outside = gstackReads('pi', [anthropic([['read', { path: '/home/user/.local/share/gstack/review/SKILL.md' }]], ['# review'])], dir);
    expect([inCatalog.contaminated, outside.contaminated]).toEqual([false, true]);
  });
});
