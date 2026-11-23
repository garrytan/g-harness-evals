import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { descriptionShown, mapCell, parseListing, place } from '../scripts/skills-at-scale/listing-map.ts';
import { ladder, synthSkills, spread } from '../scripts/skills-at-scale/synth-catalog.ts';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildKit, catalogSha, drawPins } from '../scripts/skills-at-scale/build-kit.ts';
import { parseConfig, setupArgv, systemPreamble, GBRAIN_CATALOG } from '../scripts/skills-at-scale/arm.ts';

const D1 = 'Use this skill to write the hiring report with the kazo tool. Keeps a log of every step.';
const D2 = 'Checklist to review api zone email work with the pekmute tool.';
const catalog = [{ name: 'hiring-report', description: D1, target: true }, { name: 'api-zone-email', description: D2 }, { name: 'not-listed', description: 'A skill the listing leaves out entirely, for the place test.' }];

describe('parseListing reads each harness listing', () => {
  test('Claude Code: entries after the Skill tool header, with and without descriptions', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: '<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- hiring-report: ' + D1 + '\n- api-zone-email\n- init\n</system-reminder>' }] }] };
    const l = parseListing('claude-code', body);
    expect(l.entries.map((e) => e.name)).toEqual(['hiring-report', 'api-zone-email', 'init']);
    const c = mapCell({ harness: 'claude-code', config: 'skills-catalog', size: 3, body, catalog, loaded: new Set(['hiring-report', 'api-zone-email', 'not-listed']), loadedSource: 'init' });
    expect(c.skills).toEqual({ 'hiring-report': 'with_description', 'api-zone-email': 'name_only', 'not-listed': 'loaded_not_shown' });
    expect(c.targets.with_description).toBe(1);
    expect(c.harness_skills_listed).toEqual(['init']);
  });
  test('Codex: entries under the catalog root count, .system ones are the harness\'s own', () => {
    const region = '<skills_instructions>\n### Skill roots\n- \x60r0\x60 = \x60/harness-state/codex/skills\x60\n- \x60r1\x60 = \x60/harness-state/codex/skills/.system\x60\n### Available skills\n- imagegen: Generate images (file: r1/imagegen/SKILL.md)\n- hiring-report: Use this sk (file: r0/hiring-report/SKILL.md)\n- api-zone-email: ' + D2 + ' (file: r0/api-zone-email/SKILL.md)\n</skills_instructions>';
    const c = mapCell({ harness: 'codex', config: 'skills-catalog', size: 3, body: { instructions: 'x', input: [{ content: [{ text: region }] }] }, catalog, loaded: null, loadedSource: null });
    expect(c.skills).toEqual({ 'hiring-report': 'name_only', 'api-zone-email': 'with_description', 'not-listed': 'not_shown' });
    expect(c.harness_skills_listed).toEqual(['imagegen']);
  });
  test('Hermes: a skill is a catalog skill when it sits in its own category; the cut keeps a 40-character prefix', () => {
    const region = '<available_skills>\n  hiring-report:\n    - hiring-report: ' + D1.slice(0, 57) + '...\n  autonomous-ai-agents: Skills for agents.\n    - codex: Delegate coding.\n</available_skills>';
    const c = mapCell({ harness: 'hermes', config: 'skills-catalog', size: 3, body: { system: region }, catalog, loaded: null, loadedSource: null });
    expect(c.skills['hiring-report']).toBe('with_description');
    expect(c.skills['api-zone-email']).toBe('not_shown');
    expect(c.harness_skills_listed).toEqual(['codex']);
  });
  test('OpenClaw, Pi and Gemini CLI: the last <available_skills> list, by location', () => {
    const xml = 'Scan <available_skills> for a matching workflow.\n<available_skills>\n  <skill>\n    <name>hiring-report</name>\n    <location>/workspace/skills/hiring-report/SKILL.md</location>\n  </skill>\n  <skill>\n    <name>canvas</name>\n    <description>Draw.</description>\n    <location>/opt/openclaw/skills/canvas/SKILL.md</location>\n  </skill>\n</available_skills>';
    const c = mapCell({ harness: 'openclaw', config: 'skills-catalog', size: 3, body: { system: [{ text: xml }] }, catalog, loaded: new Set(['hiring-report', 'api-zone-email']), loadedSource: 'openclaw skills list' });
    expect(c.skills).toEqual({ 'hiring-report': 'name_only', 'api-zone-email': 'loaded_not_shown', 'not-listed': 'not_loaded' });
    expect(c.harness_skills_listed).toEqual(['canvas']);
    const pi = '<available_skills>\n  <skill>\n    <name>hiring-report</name>\n    <description>' + D1.replace('.', '&amp;.') + '</description>\n    <location>/harness-state/pi/skills/hiring-report/SKILL.md</location>\n  </skill>\n</available_skills>';
    expect(mapCell({ harness: 'pi', config: 'skills-catalog', size: 3, body: { system: pi }, catalog, loaded: null, loadedSource: null }).skills['hiring-report']).toBe('with_description');
  });
  test('descriptionShown and place', () => {
    expect(descriptionShown('Use this skill  to write', 'Use this skill to write more')).toBe(23);
    expect(place(undefined, 'x', null, 'a')).toBe('not_shown');
    expect(place({ name: 'a', shown: 'short', location: null, catalog: true }, 'short', null, 'a')).toBe('with_description');
  });
});

describe('the synthetic ladder', () => {
  test('rungs are nested, the targets spread over the alphabet, and the same seed gives the same skills', () => {
    const skills = synthSkills(300, 7);
    expect(new Set(skills.map((s) => s.name)).size).toBe(300);
    expect(new Set(skills.map((s) => s.tool_word)).size).toBe(300);
    expect(synthSkills(300, 7).map((s) => s.name)).toEqual(skills.map((s) => s.name));
    const rungs = ladder(skills, [20, 100, 300]);
    expect(rungs.map((r) => r.names.length)).toEqual([20, 100, 300]);
    for (let i = 1; i < rungs.length; i++) for (const n of rungs[i - 1]!.names) expect(rungs[i]!.names).toContain(n);
    const pos = rungs[0]!.names.map((n) => skills.findIndex((s) => s.name === n));
    expect(pos[0]!).toBeLessThan(15);
    expect(pos.at(-1)!).toBeGreaterThan(285);
    expect(spread(10, 5)).toEqual([1, 3, 5, 7, 9]);
  });
  test('pins: 20 targets by a seeded pick, lines of at most 100 characters with no angle brackets', () => {
    const skills = synthSkills(200, 3).map((s, i) => ({ name: s.name, description: s.description + ' <x>', target: i % 2 === 0 }));
    const pins = drawPins(skills);
    expect(pins.length).toBe(20);
    expect(pins.every((p) => p.line.length <= 100 && !/[<>]/.test(p.line))).toBe(true);
    expect(pins.every((p) => skills.find((s) => s.name === p.id)!.target)).toBe(true);
    expect(drawPins(skills)).toEqual(pins);
    const marked = skills.map((s, i) => ({ ...s, pin: i < 6 }));
    expect(drawPins(marked).map((p) => p.id)).toEqual(marked.slice(0, 6).map((s) => s.name).sort());
  });
  test('the kit refuses an --out that holds its catalog, and the catalog digest covers supporting files', () => {
    const root = mkdtempSync(join(tmpdir(), 'sas-kit-'));
    mkdirSync(join(root, 'cat', 'skills', 'a'), { recursive: true });
    writeFileSync(join(root, 'cat', 'skills', 'a', 'SKILL.md'), '---\nname: a\ndescription: d\n---\n');
    expect(() => buildKit({ catalog: join(root, 'cat'), out: root })).toThrow('holds the catalog');
    const before = catalogSha(join(root, 'cat'));
    writeFileSync(join(root, 'cat', 'skills', 'a', 'template.md'), 't');
    expect(catalogSha(join(root, 'cat'))).not.toBe(before);
  });
});

describe('the arm configs', () => {
  test('parseConfig takes the three arms, the limit variants on OpenClaw only', () => {
    expect(parseConfig('codex', 'skills-gbrain-setup')).toEqual({ arm: 'gbrain-setup', limits: null });
    expect(parseConfig('openclaw', 'skills-gbrain-setup')).toEqual({ arm: 'gbrain-setup', limits: 'fit' });
    expect(parseConfig('openclaw', 'skills-catalog-default-limits')).toEqual({ arm: 'catalog', limits: 'default' });
    expect(parseConfig('openclaw', 'skills-gbrain-pins-printed-fix')).toEqual({ arm: 'gbrain-pins', limits: 'printed-fix' });
    expect(parseConfig('codex', 'skills-catalog-default-limits')).toContain('OpenClaw variant');
    expect(parseConfig('pi', 'skills-native')).toContain('not a skills-at-scale config');
    expect(parseConfig('qm', 'skills-catalog')).toContain('no skills-at-scale arm');
    expect(parseConfig('hermes', 'skills-gbrain-setup-system-preamble')).toEqual({ arm: 'gbrain-setup', limits: null, system_preamble: true });
    expect(parseConfig('pi', 'skills-gbrain-setup-system-preamble')).toContain('Hermes variant');
  });
  test('the system preamble and preamble.turn.md together hold the whole task preamble', () => {
    const pre = readFileSync('tasks/multiuser/_shared/preamble.md', 'utf8');
    const turn = readFileSync('scripts/skills-at-scale/preamble.turn.md', 'utf8');
    const sys = systemPreamble(pre);
    expect(sys).not.toContain('{{');
    expect(sys.replace('Each member turn says who is writing, where and when, then gives their message.\n\n', turn + '\n')).toBe(pre);
    expect(readFileSync('scripts/skills-at-scale/preamble.message-only.md', 'utf8')).toBe('{{message}}\n');
  });
  test('the installer command lines are the ones a user types', () => {
    expect(setupArgv('openclaw')).toEqual(['setup', 'openclaw', '--skill-loading', 'resolve', '--agent', 'main']);
    expect(setupArgv('pi')).toEqual(['setup', 'pi', '--skill-loading', 'resolve']);
    expect(GBRAIN_CATALOG.hermes).toBe('hermes-user');
  });
});
