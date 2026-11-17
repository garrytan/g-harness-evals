// The skill-open rule from the stage 1 amendment 2 (the review preamble handshake) and its /ship twin for stage 2's
// ship-panel arm (exposure.ts --skill ship). Keyless: small Claude Code transcripts written here.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT, GATE_SKILLS, main, readClaudeCode } from '../../scripts/review-bugs/exposure.ts';
import { FIXTURES } from '../fixtures/review-bugs/exposure/materialize.ts';

const tmp = mkdtempSync(join(tmpdir(), 'exposure-skill-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function transcript(name: string, command: string, result: string, isError = false): string {
  const lines = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: result, is_error: isError }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
    { type: 'result', subtype: 'success' },
  ];
  const file = join(tmp, name + '.ndjson');
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

const review = transcript('review', '~/.claude/skills/gstack/bin/gstack-skill-start --skill "review" --model "claude"', 'SKILL_START_PROTO: 1\nSESSION: x');
const ship = transcript('ship', '~/.claude/skills/gstack/bin/gstack-skill-start --skill ship --model claude', 'SKILL_START_PROTO: 1');
const noProto = transcript('no-proto', 'gstack-skill-start --skill "ship"', 'command not found');
const errored = transcript('errored', 'gstack-skill-start --skill "review"', 'SKILL_START_PROTO: 1', true);
const prefix = transcript('prefix', 'gstack-skill-start --skill "review-bots"', 'SKILL_START_PROTO: 1');

describe('the preamble handshake opens the skill it names', () => {
  test('the gate skills are review and ship', () => expect([...GATE_SKILLS]).toEqual(['review', 'ship']));
  test('review: the /review preamble counts, as amendment 2 says', () => {
    const s = readClaudeCode(review);
    expect(s.skill.opened).toBe(true);
    expect(s.skill.how).toBe('review skill preamble: gstack-skill-start --skill review');
    expect(readClaudeCode(review, 'ship').skill.opened).toBe(false);
  });
  test('ship: the /ship preamble counts only for --skill ship', () => {
    expect(readClaudeCode(ship, 'ship').skill).toMatchObject({ opened: true, how: 'ship skill preamble: gstack-skill-start --skill ship' });
    expect(readClaudeCode(ship).skill.opened).toBe(false);
  });
  test('no PROTO line, an error result or another skill name opens nothing', () => {
    expect(readClaudeCode(noProto, 'ship').skill.opened).toBe(false);
    expect(readClaudeCode(errored).skill.opened).toBe(false);
    expect(readClaudeCode(prefix).skill.opened).toBe(false);
  });
});

describe('the CLI takes --skill', () => {
  const sessions = join(tmp, 'sessions.tsv');
  writeFileSync(sessions, 'unit\tpass\tharness\tpath\nu\t1\tclaude-code\t' + ship + '\n');
  const map = join(FIXTURES, 'reader-map.json');
  const expected = join(tmp, 'expected.json');
  writeFileSync(expected, JSON.stringify({ u: [] }));
  const run = (...extra: string[]) => { let out = '', err = ''; const code = main(['--sessions', sessions, '--map', map, '--expected', expected, '--json', ...extra], (s) => { out += s; }, (s) => { err += s; }); return { code, out, err }; };
  test('--skill ship passes the gate on the ship preamble; the default (review) does not', () => {
    const s = run('--skill', 'ship');
    expect(s.code).toBe(EXIT.ok);
    expect(JSON.parse(s.out).rows[0].gate).toBe('pass');
    expect(JSON.parse(run().out).rows[0].gate).toBe('fail (skill not opened)');
  });
  test('--skill takes only review or ship', () => expect(run('--skill', 'qa').code).toBe(EXIT.usage));
  test('--skill ship refuses a session from another harness', () => {
    const codex = join(tmp, 'sessions-codex.tsv');
    writeFileSync(codex, 'unit\tpass\tharness\tpath\nu\t1\tcodex\t' + ship + '\n');
    let err = '';
    expect(main(['--sessions', codex, '--map', map, '--expected', expected, '--json', '--skill', 'ship'], () => undefined, (s) => { err += s; })).toBe(EXIT.usage);
    expect(err).toContain('--skill ship reads only claude-code sessions, not codex');
  });
});

describe('stage 2 Amendment 4, fix 6: the preamble match takes ;, &&, (...) and --skill=', () => {
  const forms = (skill: string) => [
    'gstack-skill-start --skill ' + skill + '; echo started',
    'gstack-skill-start --skill "' + skill + '"&& echo started',
    'gstack-skill-start --skill ' + skill + '&&echo started',
    '(gstack-skill-start --skill ' + skill + ')',
    'echo "$(~/.claude/skills/gstack/bin/gstack-skill-start --skill \'' + skill + '\')"',
    'gstack-skill-start --skill=' + skill + ' --model claude',
    'gstack-skill-start --skill="' + skill + '";',
    'gstack-skill-start --skill ' + skill + '|| true',
  ];
  test('ship: every form opens /ship, and none opens /review', () => {
    forms('ship').forEach((c, i) => {
      const f = transcript('a4-ship-' + i, c, 'SKILL_START_PROTO: 1');
      expect(readClaudeCode(f, 'ship').skill).toMatchObject({ opened: true, how: 'ship skill preamble: gstack-skill-start --skill ship' });
      expect(readClaudeCode(f).skill.opened).toBe(false);
    });
  });
  test('review shares the matcher: every form opens /review, and none opens /ship', () => {
    forms('review').forEach((c, i) => {
      const f = transcript('a4-review-' + i, c, 'SKILL_START_PROTO: 1');
      expect(readClaudeCode(f).skill.opened).toBe(true);
      expect(readClaudeCode(f, 'ship').skill.opened).toBe(false);
    });
  });
  test('a longer skill name, an error result or no PROTO line still opens nothing', () => {
    for (const c of ['gstack-skill-start --skill=ship-panel', 'gstack-skill-start --skill=shipit;', 'gstack-skill-start --skill review-bots&&x', 'gstack-skill-start --skill=reviewer)']) {
      const f = transcript('a4-neg-' + c.length, c, 'SKILL_START_PROTO: 1');
      expect(readClaudeCode(f, 'ship').skill.opened).toBe(false);
      expect(readClaudeCode(f).skill.opened).toBe(false);
    }
    expect(readClaudeCode(transcript('a4-err', 'gstack-skill-start --skill=ship;', 'SKILL_START_PROTO: 1', true), 'ship').skill.opened).toBe(false);
    expect(readClaudeCode(transcript('a4-noproto', 'gstack-skill-start --skill=ship;', 'started'), 'ship').skill.opened).toBe(false);
  });
});
