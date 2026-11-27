import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, effort, trialEffort, turnsFromOpenClawSession, turnsFromQmSession, turnsFromTrajectory } from '../scripts/mcp-at-scale/search-effort.ts';
import { ALLOW, TOKEN_PATTERNS } from '../scripts/publish-audit.ts';
import { plan } from '../scripts/mcp-at-scale/search-script.ts';

const FIXTURE = join(import.meta.dir, '../scripts/mcp-at-scale/fixtures/search-effort.json');
const raw = readFileSync(FIXTURE, 'utf8');
const fx = JSON.parse(raw) as { target: { server: string; tool: string }; cases: Array<{ variant: string; version: string; source: 'trajectory' | 'openclaw-session' | 'qm-session'; transcript: any; right_tool: boolean }> };
const T = fx.target;

const EXPECTED: Record<string, { search: number; turnsBefore: number; mechanisms: string[] }> = {
  'claude-code@2.1.312': { search: 1, turnsBefore: 1, mechanisms: ['ToolSearch', 'direct'] },
  'claude-code-no-tool-search@2.1.312': { search: 0, turnsBefore: 0, mechanisms: ['direct'] },
  'codex@0.165.0': { search: 1, turnsBefore: 1, mechanisms: ['exec'] },
  'codex@0.170.0': { search: 1, turnsBefore: 1, mechanisms: ['exec'] },
  'hermes@v2026.9.24': { search: 1, turnsBefore: 1, mechanisms: ['tool_search', 'tool_call'] },
  'pi-codemode@1.5.0': { search: 1, turnsBefore: 1, mechanisms: ['codemode'] },
  'pi-deferred@1.5.0': { search: 1, turnsBefore: 1, mechanisms: ['tool_search', 'direct'] },
  'pi-direct@1.5.0': { search: 0, turnsBefore: 0, mechanisms: ['direct'] },
  'openclaw@2026.10.6': { search: 1, turnsBefore: 1, mechanisms: ['tool_search', 'tool_call'] },
  'openclaw@2026.11.5': { search: 1, turnsBefore: 1, mechanisms: ['tool_search', 'dispatch_action'] },
  'qm@main@7d552d94': { search: 1, turnsBefore: 1, mechanisms: ['tool_search', 'mcp_call'] },
};

describe('search effort on captured transcripts', () => {
  test('the fixtures cover every cell and hold no token', () => {
    expect(fx.cases.map((c) => c.variant + '@' + c.version).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [name, re] of Object.entries(TOKEN_PATTERNS)) {
      const hits = [...raw.matchAll(new RegExp(re.source, re.flags))].map((m) => m[0]).filter((h) => !ALLOW.some((a) => a.test(h)));
      expect({ name, hits }).toEqual({ name, hits: [] });
    }
    expect(raw.length).toBeLessThan(20000);
  });

  for (const c of fx.cases) {
    test(c.variant + '@' + c.version + ' reaches the target through its own search route', () => {
      const turns = c.source === 'trajectory' ? turnsFromTrajectory(c.transcript) : c.source === 'qm-session' ? turnsFromQmSession(c.transcript) : turnsFromOpenClawSession(c.transcript);
      const e = effort(turns, T, c.source);
      const want = EXPECTED[c.variant + '@' + c.version]!;
      expect(c.right_tool).toBe(true);
      expect(e).toMatchObject({ found: true, search_calls_before_right: want.search, turns_before_right: want.turnsBefore, first_right_turn: want.turnsBefore + 1, wrong_calls_before_right: 0, mechanisms: want.mechanisms });
    });
  }
});

describe('scripted search model', () => {
  const ST = { ...T, args: { workspace: 'acme', title: 'x' }, query: 'ash tracker create issue' };
  const tool = (name: string, schema: object) => ({ name, description: '', input_schema: schema });
  const openclaw = (messages: object[]) => ({ model: 'm', messages, tools: [tool('exec', { type: 'object', required: ['command'], properties: { command: { type: 'string' } } }), tool('tool_search', { type: 'object', properties: { query: { type: 'string' } } }), tool('dispatch_action', { type: 'object', required: ['id'], properties: { id: { type: 'string' }, args: { type: 'object' } } })] });
  test('uses OpenClaw 2026.11 dispatch_action after a search and never its shell exec', () => {
    const user = { role: 'user', content: 'make an issue' };
    expect(plan(openclaw([user]), ST)).toEqual({ name: 'tool_search', input: { query: 'ash tracker create issue' } });
    const after = openclaw([user,
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'tool_search', input: { query: 'q' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '{"id": "mcp:ash-tracker:ash-tracker__create_issue"}' }] }]);
    expect(plan(after, ST)).toEqual({ name: 'dispatch_action', input: { id: 'mcp:ash-tracker:ash-tracker__create_issue', args: ST.args } });
  });
});

describe('classify', () => {
  test('separates search, describe, right, wrong and other calls', () => {
    expect(classify({ name: 'ToolSearch', args: { query: 'select:mcp__ash-tracker__create_issue' } }, T)).toEqual(['search']);
    expect(classify({ name: 'tool_describe', args: { id: 'mcp:ash-tracker:ash-tracker__create_issue' } }, T)).toEqual(['describe']);
    expect(classify({ name: 'mcp__birch-tracker__create_issue', args: {} }, T)).toEqual(['wrong']);
    expect(classify({ name: 'tool_call', args: { calls: [{ name: 'mcp__birch_tracker__create_issue', arguments: {} }] } }, T)).toEqual(['wrong']);
    expect(classify({ name: 'dispatch_action', args: { id: 'mcp:ash-tracker:ash-tracker__create_issue', args: {} } }, T)).toEqual(['right']);
    expect(classify({ name: 'codemode', args: { code: 'const h = await searchTools("x");\nawait tools.mcp__ash_tracker__create_issue({});' } }, T)).toEqual(['search', 'right']);
    expect(classify({ name: 'codemode', args: { code: 'await describeTool("mcp__ash_tracker__create_issue")' } }, T)).toEqual(['search']);
    expect(classify({ name: 'exec', args: { command: 'ls', input: 'tools.mcp__ash_tracker__create_issue()' } }, T)).toEqual(['other']);
    expect(classify({ name: 'exec', args: 'text(JSON.stringify(ALL_TOOLS.length))' }, T)).toEqual(['search']);
    expect(classify({ name: 'Bash', args: { command: 'ls' } }, T)).toEqual(['other']);
    expect(classify({ name: 'mcp_call', args: { server: 'birch-tracker', tool: 'create_issue', args: {} } }, T)).toEqual(['wrong']);
  });

  test('QM: a call held for approval is the model call, and server ids map back to server names', () => {
    const held = { kind: 'ToolCall', tool: 'at-2_create_issue', body: { blocked: 'needs_approval', wire: { name: 'mcp_call', argumentsJson: '{"server":"at-2","tool":"create_issue","args":{}}', message: { id: 'm1' } } } };
    const turns = turnsFromQmSession({ items: [held] }, { 'at-2': 'ash-tracker' });
    expect(turns).toEqual([[{ name: 'mcp_call', args: { server: 'ash-tracker', tool: 'create_issue', args: {} } }]]);
    expect(effort(turns, T, 'qm-session')).toMatchObject({ found: true, first_right_turn: 1, mechanisms: ['mcp_call'] });
  });

  test('counts everything before the first right call and stops there', () => {
    const e = effort([
      [{ name: 'tool_search', args: {} }, { name: 'tool_search', args: {} }],
      [{ name: 'tool_describe', args: {} }, { name: 'mcp__lark-db__create_issue', args: {} }],
      [{ name: 'Read', args: {} }],
      [{ name: 'mcp__ash-tracker__create_issue', args: {} }, { name: 'tool_search', args: {} }],
      [{ name: 'tool_search', args: {} }],
    ], T, 'trajectory');
    expect(e).toMatchObject({ turns: 5, found: true, first_right_turn: 4, turns_before_right: 3, search_calls_before_right: 2, describe_calls_before_right: 1, wrong_calls_before_right: 1, other_calls_before_right: 1 });
  });

  test('a trial with no transcript reports source null, not a miss with zero effort', () => {
    const d = mkdtempSync(join(tmpdir(), 'mcp-effort-'));
    try {
      mkdirSync(join(d, 'agent'));
      expect(trialEffort(d, T)).toMatchObject({ source: null, found: false, turns: 0 });
      writeFileSync(join(d, 'agent', 'openclaw.session.jsonl'), '{"type":"session"}\nnot json\n{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"tool_call","arguments":{"id":"mcp:ash-tracker:ash-tracker__create_issue"}}]}}\n');
      expect(trialEffort(d, T)).toMatchObject({ source: 'openclaw-session', found: true, first_right_turn: 1 });
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
