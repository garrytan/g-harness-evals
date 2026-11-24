// Keyless test of scripts/skills-at-scale/saw.ts, outcome 1 of the skills-at-scale eval: which catalog skills the captured
// requests listed with a description, by name only, or named in a gbrain resolver block (internal-task).

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCatalogDescriptions, sawSkill } from '../scripts/skills-at-scale/saw.ts';

const LONG = 'Draft the weekly hiring report from the applicant tracker and the interview notes.';
const catalog = new Map([['hiring-report', LONG], ['pipeline-review', 'Review the sales pipeline and flag deals that slipped a stage this week.'], ['offsite-plan', 'Plan a team offsite with a venue, an agenda and a budget.']]);
const claude = (lines: string[]) => ({ system: [{ type: 'text', text: 'The following skills are available for use with the Skill tool:\n\n' + lines.join('\n') + '\n' }], messages: [{ role: 'user', content: 'hi' }] });
const block = (...ids: string[]) => '<relevant_skills>\nSkills that may fit this request.\n' + ids.map((i) => '- id: "' + i + '" name: "' + i + '" summary: "x"').join('\n') + '\n</relevant_skills>';

describe('skills-at-scale saw-skill record', () => {
  test('a listing with 40 characters of the description is described; a shorter one is name only; skills not in the catalog are ignored', () => {
    const r = sawSkill({ harness: 'claude-code', catalog, requests: [claude(['- hiring-report: ' + LONG, '- pipeline-review: Review the', '- update-config: Use this skill to configure the harness itself, nothing else.'])] });
    expect(r).toEqual({ described: ['hiring-report'], name_only: ['pipeline-review'], resolver: [], block_requests: 0, requests: 1 });
  });

  test('a resolver block names a skill as described, over every request, and lifts it out of name only', () => {
    const r = sawSkill({ harness: 'claude-code', catalog, requests: [claude(['- pipeline-review: Review the']), { messages: [{ role: 'user', content: [{ type: 'text', text: block('pipeline-review', 'offsite-plan', 'not-in-catalog') + '\nplan our offsite' }] }] }] });
    expect(r).toEqual({ described: ['offsite-plan', 'pipeline-review'], name_only: [], resolver: ['offsite-plan', 'pipeline-review'], block_requests: 1, requests: 2 });
  });

  test('text that only quotes the tag, or a block naming no catalog skill, is not a resolver block', () => {
    const quoted = { messages: [{ role: 'user', content: [{ type: 'tool_result', content: 'the hook prints only the <relevant_skills> block' }] }] };
    const r = sawSkill({ harness: 'claude-code', catalog, requests: [quoted, { prompt: block('not-in-catalog') }] });
    expect(r.block_requests).toBe(0);
    expect(r.resolver).toEqual([]);
  });

  test('QM: the Skills block is read as qm-listing.ts reads it', () => {
    const body = { input: [{ role: 'system', content: 'You are QM.\n\n## Skills\nUse a skill when it fits.\n- hiring-report — ' + LONG + '\n- offsite-plan\n\n## Tools\nnone' }] };
    expect(sawSkill({ harness: 'qm', catalog, requests: [body] })).toEqual({ described: ['hiring-report'], name_only: ['offsite-plan'], resolver: [], block_requests: 0, requests: 1 });
  });

  test('no request means nothing seen; a harness with no listing parser still counts resolver blocks', () => {
    expect(sawSkill({ harness: 'codex', catalog, requests: [] })).toEqual({ described: [], name_only: [], resolver: [], block_requests: 0, requests: 0 });
    expect(sawSkill({ harness: 'other', catalog, requests: [{ prompt: block('hiring-report') }] }).described).toEqual(['hiring-report']);
  });

  test('a catalog file gives descriptions only when every skill has one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'saw-'));
    writeFileSync(join(dir, 'full.json'), JSON.stringify({ skills: [{ name: 'a', description: 'x' }, { name: 'b', description: 'y' }] }));
    writeFileSync(join(dir, 'names.json'), JSON.stringify({ skills: [{ name: 'a', description: 'x' }, { name: 'b' }] }));
    writeFileSync(join(dir, 'names.txt'), 'a\nb\n');
    expect([...readCatalogDescriptions(join(dir, 'full.json'))!]).toEqual([['a', 'x'], ['b', 'y']]);
    expect(readCatalogDescriptions(join(dir, 'names.json'))).toBeNull();
    expect(readCatalogDescriptions(join(dir, 'names.txt'))).toBeNull();
  });
});
