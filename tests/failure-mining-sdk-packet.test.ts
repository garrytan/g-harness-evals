import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { estimateTokens, hashPacket, packetText } from '../scripts/failure-mining/packet.ts';
import { buildSdkPackets, capSdkPacket, headTail, markOf, stepsOf, SOURCES } from '../scripts/failure-mining/sdk-packet.ts';

const ROOT = resolve(import.meta.dir, '..');
const SDK = join(ROOT, 'tests/fixtures/failure-mining/sdk');
const TASKS = join(ROOT, 'tasks/repo/gstack-native-v1');
const sources = [{ run: 'gn-follow-2026-11', lease: 'opus-follow', rows: 'gn-follow-2026-11/trials.jsonl' }];
const opts = { transcripts: join(SDK, 'transcripts'), results: join(SDK, 'rows'), tasksRoot: TASKS, sources };

describe('sdk-packet.ts', () => {
  test('one packet per failed session, sorted, deterministic, kind sdk, uncounted and descriptive', () => {
    const a = buildSdkPackets(opts), b = buildSdkPackets(opts);
    expect(a.packets.map((p) => p.trial_id)).toEqual(['gn-follow-2026-11/claude-opus-5-5.gstack/gn-dev-qa-01/r2', 'gn-follow-2026-11/claude-opus-5-5.none/gn-dev-qa-01/r1']);
    expect(a.packets.map((p) => JSON.stringify(p))).toEqual(b.packets.map((p) => JSON.stringify(p)));
    expect(a.counts).toEqual([
      { run: 'gn-follow-2026-11', lease: 'opus-follow', arm: 'gstack', sessions: 1, failed: 1, packets: 1 },
      { run: 'gn-follow-2026-11', lease: 'opus-follow', arm: 'none', sessions: 2, failed: 1, packets: 1 },
    ]);
    for (const p of a.packets) {
      expect(p).toMatchObject({ kind: 'sdk', population: 'uncounted', reporting: 'descriptive', grade: 'fail', reward: 0, task: { id: 'gn-dev-qa-01', set: 'gstack-native-v1' } });
      expect(p.task.prompt).toContain('/work/app/SPEC.md');
      expect(p.failed_predicates).toEqual([{ id: 'verifier_reward', kind: 'required', evidence: 'reward=0' }]);
      expect(hashPacket(JSON.parse(packetText(p))).packet_sha256).toBe(p.packet_sha256);
      expect(Object.keys(p.inputs).sort()).toEqual(['instruction.md', 'sdk-messages.jsonl', 'trial row']);
      expect(JSON.stringify(p)).not.toContain('signature');
    }
    expect(a.index.map((l) => [l.arm, l.population, l.reporting, l.gstack_present, l.packet_sha256 === a.packets.find((p) => p.trial_id === l.trial_id)!.packet_sha256])).toEqual([['gstack', 'uncounted', 'descriptive', true, true], ['none', 'uncounted', 'descriptive', false, true]]);
  });

  test('steps pair each tool call with its result; the gstack arm carries its Lane B flags, the none arm has gstack null', () => {
    const [g, n] = buildSdkPackets(opts).packets;
    expect(g!.gstack).toMatchObject({ installed: true, invoked: true, cmd_expanded: true, marked_steps: [] });
    expect(g!.gstack!.skill_probe).toMatchObject({ skill: 'qa', followed: false });
    expect(n!.gstack).toBeNull();
    const first = n!.steps.find((s) => s.kind === 'tool')!;
    expect(first).toMatchObject({ tool: 'Bash', input: { command: expect.stringContaining('SPEC.md') }, is_error: false });
    expect(first.result).toContain('SPEC.md');
    expect(n!.steps.at(-1)).toMatchObject({ kind: 'result', is_error: false });
    expect(n!.steps.map((s) => s.step)).toEqual(n!.steps.map((_, i) => i));
  });

  test('marks Skill calls, gstack SKILL.md reads and gstack bin scripts', () => {
    expect(markOf('Skill', { skill: 'qa' }, 'none')).toBe('skill_call');
    expect(markOf('Read', { file_path: '/root/.claude/skills/gstack/qa/SKILL.md' }, 'none')).toBe('gstack_skill_md_read');
    expect(markOf('Read', { file_path: '/root/.claude/skills/qa/SKILL.md' }, 'gstack')).toBe('gstack_skill_md_read');
    expect(markOf('Read', { file_path: '/root/.claude/skills/qa/SKILL.md' }, 'placebo')).toBeUndefined();
    expect(markOf('Bash', { command: '~/.claude/skills/gstack/bin/gstack-skill-start --skill "qa"' }, 'gstack')).toBe('gstack_bin');
    expect(markOf('Bash', { command: 'ls' }, 'gstack')).toBeUndefined();
    const steps = stepsOf([
      { type: 'AssistantMessage', t: 1, content: [{ thinking: 'x', signature: 's' }, { text: 'Looking.' }, { id: 'a', name: 'Skill', input: { skill: 'qa' } }] },
      { type: 'UserMessage', t: 2, content: [{ tool_use_id: 'a', content: [{ type: 'text', text: 'loaded' }], is_error: true }] },
      { type: 'ResultMessage', t: 3, result: 'done', is_error: false },
    ], 'none');
    expect(steps).toEqual([
      { step: 0, t: 1, kind: 'text', text: 'Looking.' },
      { step: 1, t: 1, kind: 'tool', tool: 'Skill', input: { skill: 'qa' }, result: 'loaded', is_error: true, mark: 'skill_call' },
      { step: 2, t: 3, kind: 'result', text: 'done', is_error: false },
    ]);
  });

  test('results keep their head and tail; the cap drops the oldest results, then the oldest steps', () => {
    expect(headTail('a'.repeat(10) + 'b'.repeat(10), 5, 5)).toBe('aaaaa…[10 chars cut]…bbbbb');
    const p = buildSdkPackets(opts).packets[1]!;
    const size = estimateTokens(packetText(p));
    const cut = capSdkPacket(p, size - 50);
    expect(cut.truncation.dropped_result_steps[0]).toBe(p.steps.find((s) => s.kind === 'tool' && s.result)!.step);
    expect(cut.truncation.dropped_steps).toEqual([]);
    const tiny = capSdkPacket(p, 700);
    expect(tiny.truncation.dropped_steps.length).toBeGreaterThan(0);
    expect(tiny.truncation.dropped_steps).toEqual(p.steps.slice(0, tiny.truncation.dropped_steps.length).map((s) => s.step));
  });

  test('the four internal-task sources are listed with the rows of record', () => {
    expect(SOURCES.map((s) => [s.run, s.lease, s.rows, s.arm ?? null])).toEqual([
      ['gn-follow-2026-11', 'opus-follow', 'gn-follow-2026-11/trials.jsonl', null],
      ['gn-follow-preset-2026-11', 'opus-follow-preset', 'gn-follow-preset-2026-11/trials.jsonl', null],
      ['gn-hard-follow-2026-11', 'opus-hard-gstack', 'gn-hard-follow-2026-11/reprobed-trials.jsonl', 'gstack'],
      ['gn-hard-follow-2026-11', 'opus-hard-none', 'gn-hard-follow-2026-11/reprobed-trials.jsonl', 'none'],
    ]);
  });
});
